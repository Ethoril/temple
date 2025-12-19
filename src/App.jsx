import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Sky, Grid } from '@react-three/drei';
import { v4 as uuidv4 } from 'uuid';
import * as THREE from 'three';

// --- 0. VERSIONNING ---
const APP_VERSION = "v0.9.0 (Height Lock)";

// --- 1. CONFIGURATION MATÉRIAUX ---
const MATERIALS = {
  stone: { color: '#808080', name: 'Pierre' },
  wood: { color: '#8B4513', name: 'Bois' },
  gold: { color: '#FFD700', name: 'Or' },
  brick: { color: '#A52A2A', name: 'Brique' },
  water: { color: '#4FC3F7', name: 'Eau', opacity: 0.6 },
  grass: { color: '#4CAF50', name: 'Herbe' },
  roof:   { color: '#8B0000', name: 'Tuile' },
};

// --- 2. CONFIGURATION DES FORMES ---
const SHAPES = {
  cube:   { name: 'Cube',          heightBase: 1, defaultScale: [1, 1, 1] },
  slab:   { name: 'Dalle',         heightBase: 1, defaultScale: [1, 0.5, 1] },
  column: { name: 'Colonne',       heightBase: 1, defaultScale: [1, 1, 1] },
  slope:  { name: 'Toit (Prisme)', heightBase: 1, defaultScale: [1, 1, 1] },
};

// --- UTILITAIRES ---
const getRotation = (rot) => Array.isArray(rot) ? rot : [0, rot || 0, 0];
const getScale = (s) => Array.isArray(s) ? s : [1, 1, 1];

const createPrismGeometry = () => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(-0.5, 0.5);
  shape.lineTo(-0.5, -0.5);
  const geometry = new THREE.ExtrudeGeometry(shape, { steps: 1, depth: 1, bevelEnabled: false });
  geometry.center(); 
  return geometry;
};

// --- COMPOSANT VISUEL ---
function ShapeVisual({ shape, color, opacity = 1, isSelected, scale = [1,1,1] }) {
  const material = new THREE.MeshStandardMaterial({ 
    color: isSelected ? '#4444ff' : color, 
    emissive: isSelected ? '#0000aa' : '#000000',
    transparent: opacity < 1, 
    opacity: opacity,
    side: THREE.DoubleSide 
  });

  const geometry = useMemo(() => {
    if (shape === 'column') return new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
    if (shape === 'slope') return createPrismGeometry();
    return new THREE.BoxGeometry(1, 1, 1);
  }, [shape]);

  return (
    <group scale={scale}>
      <mesh geometry={geometry} material={material} />
      {opacity === 1 && (
        <lineSegments>
          <edgesGeometry args={[geometry]} />
          <lineBasicMaterial color={isSelected ? 'white' : 'black'} linewidth={1} />
        </lineSegments>
      )}
    </group>
  );
}

// --- GUIDE DE PLACEMENT (LASER) ---
// Modifié pour changer de couleur quand verrouillé
function PlacementGuide({ position, boxSize, isLocked }) {
    if (!position) return null;
    const color = isLocked ? '#00FF00' : 'yellow'; // Vert si lock, Jaune sinon

    return (
        <group position={[position[0], 0, position[2]]}>
            <line position={[-position[0], 0, -position[2]]}>
                <bufferGeometry>
                    <float32BufferAttribute 
                        attach="attributes-position" 
                        count={2} 
                        array={new Float32Array([position[0], position[1], position[2], position[0], 0, position[2]])} 
                        itemSize={3} 
                    />
                </bufferGeometry>
                <lineBasicMaterial attach="material" color={color} opacity={0.6} transparent />
            </line>
            <mesh 
                position={[0, 0.02, 0]} 
                rotation={[-Math.PI/2, 0, 0]}
                scale={[boxSize.x || 1, boxSize.z || 1, 1]} 
            >
                <planeGeometry args={[1, 1]} /> 
                <meshBasicMaterial color={color} opacity={0.3} transparent />
            </mesh>
            <lineSegments 
                position={[0, 0.02, 0]} 
                rotation={[-Math.PI/2, 0, 0]}
                scale={[boxSize.x || 1, boxSize.z || 1, 1]}
            >
                <edgesGeometry args={[new THREE.PlaneGeometry(1, 1)]} />
                <lineBasicMaterial color={color} />
            </lineSegments>
        </group>
    );
}

// --- SURLIGNEUR ---
function FaceHighlighter({ targetInfo }) {
    if (!targetInfo || !targetInfo.normal || !targetInfo.point) return null;
    const { point, normal } = targetInfo;
    const position = point.clone().add(normal.clone().multiplyScalar(0.01));
    const quaternion = new THREE.Quaternion();
    if (normal.length() > 0) quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

    return (
        <mesh position={position} quaternion={quaternion}>
            <planeGeometry args={[0.5, 0.5]} />
            <meshBasicMaterial color="red" opacity={0.5} transparent side={THREE.DoubleSide} />
        </mesh>
    );
}

// --- FANTÔME ---
function GhostPiece({ position, rotation, shape, materialType, groupData, scale }) {
  const rot = getRotation(rotation);
  const scl = getScale(scale);

  if (groupData) {
      return (
        <group position={position} rotation={rot}>
            {groupData.blocks.map((block, idx) => (
                <group key={idx} position={block.relPos} rotation={getRotation(block.rotation)}>
                    <ShapeVisual 
                        shape={block.shape} 
                        color={MATERIALS[block.type]?.color || 'white'} 
                        opacity={0.5} 
                        scale={getScale(block.scale)}
                    />
                </group>
            ))}
        </group>
      );
  }

  const color = MATERIALS[materialType]?.color || 'white';
  return (
    <group position={position} rotation={rot}>
        <ShapeVisual shape={shape} color={color} opacity={0.5} scale={scl} />
    </group>
  );
}

// --- PIÈCE POSÉE ---
function Piece({ data, onRemove, onClickAdd, onHover, onGrab, onSelect, isSelected, appMode }) {
  const rot = getRotation(data.rotation);
  const scl = getScale(data.scale);
  
  const handleInteraction = (e) => {
    e.stopPropagation(); 
    if (e.delta > 2) return;
    if (appMode === 'SELECT') { onSelect(data.id); return; }
    if (appMode === 'BUILD') {
        if (e.altKey) onRemove(data.id);
        else if (e.ctrlKey || e.metaKey) onGrab(data); 
        else if (e.button === 0) onClickAdd();
    }
  };

  const handlePointerMove = (e) => {
      e.stopPropagation();
      if (appMode === 'BUILD') {
          onHover(e, {
             position: data.position,
             scale: data.isGroup ? [1,1,1] : scl,
             shape: data.isGroup ? 'group' : data.shape,
             isGroup: data.isGroup,
             point: e.point,
             normal: e.face.normal
          });
      }
  };

  if (data.isGroup && data.structureData) {
      return (
        <group position={data.position} rotation={rot}>
            {data.structureData.blocks.map((block, idx) => {
                const matInfo = MATERIALS[block.type] || MATERIALS.stone;
                const blockScale = getScale(block.scale);
                const baseH = SHAPES[block.shape]?.heightBase || 1;
                const finalH = baseH * blockScale[1];

                return (
                    <group key={idx} position={block.relPos} rotation={getRotation(block.rotation)}>
                        <ShapeVisual 
                            shape={block.shape} 
                            color={matInfo.color} 
                            opacity={matInfo.opacity || 1} 
                            isSelected={isSelected} 
                            scale={blockScale}
                        />
                        <mesh visible={false} onClick={handleInteraction} onPointerMove={handlePointerMove}>
                            <boxGeometry args={[1 * blockScale[0], finalH, 1 * blockScale[2]]} />
                        </mesh>
                    </group>
                );
            })}
        </group>
      );
  }

  const matInfo = MATERIALS[data.type] || MATERIALS.stone;
  const baseH = SHAPES[data.shape]?.heightBase || 1;
  const finalH = baseH * scl[1];

  return (
    <group position={data.position} rotation={rot}>
      <ShapeVisual 
        shape={data.shape || 'cube'} 
        color={matInfo.color} 
        opacity={matInfo.opacity || 1} 
        isSelected={isSelected} 
        scale={scl}
      />
      <mesh visible={false} 
        onClick={handleInteraction}
        onPointerMove={handlePointerMove}
      >
          <boxGeometry args={[1 * scl[0], finalH, 1 * scl[2]]} />
      </mesh>
    </group>
  );
}

// --- SCÈNE ---
function Scene({ 
  pieces, setPieces, 
  saveHistory,
  currentMat, currentShape, rotation, setRotation, currentScale,
  appMode, selectedIds, setSelectedIds,
  onGrabBlock,
  currentGroup 
}) {
  const [hoverPos, setHoverPos] = useState(null);
  const [guideSize, setGuideSize] = useState({x:1, z:1});
  const [targetInfo, setTargetInfo] = useState(null);
  
  // --- NOUVEAU : GESTION DU LOCK ---
  const [lockedY, setLockedY] = useState(null); // Stocke la hauteur verrouillée

  useEffect(() => {
    const handleInput = (e) => {
      // Rotation
      if (e.key.toLowerCase() === 'r') setRotation(prev => [prev[0], prev[1] + Math.PI / 2, prev[2]]);
      if (e.key.toLowerCase() === 't') setRotation(prev => [prev[0] + Math.PI / 2, prev[1], prev[2]]);
      if (e.key.toLowerCase() === 'g') setRotation(prev => [prev[0], prev[1], prev[2] + Math.PI / 2]);
      
      // LOCK (Shift)
      if (e.key === 'Shift') {
          // On ne lock que si on a déjà une position valide sous la souris
          if (hoverPos) {
              setLockedY(hoverPos[1]); // On capture la hauteur actuelle
          }
      }
    };
    
    const handleKeyUp = (e) => {
        if (e.key === 'Shift') {
            setLockedY(null); // On libère le lock
        }
    };

    window.addEventListener('keydown', handleInput);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
        window.removeEventListener('keydown', handleInput);
        window.removeEventListener('keyup', handleKeyUp);
    };
  }, [hoverPos, setRotation]);

  useEffect(() => { if (appMode !== 'BUILD') { setHoverPos(null); setTargetInfo(null); setLockedY(null); } }, [appMode]);

  const addBlock = () => {
    if (!hoverPos || appMode !== 'BUILD') return;
    saveHistory();

    if (currentGroup) {
        const newGroupPiece = {
            id: uuidv4(),
            position: hoverPos,
            rotation: rotation,
            isGroup: true,
            structureData: currentGroup,
            type: 'structure',
            name: currentGroup.name
        };
        setPieces(prev => [...prev, newGroupPiece]);
        return;
    }

    const newPiece = { 
      id: uuidv4(), 
      position: hoverPos,
      type: currentMat,
      shape: currentShape,
      rotation: rotation,
      scale: currentScale
    };
    setPieces(prev => [...prev, newPiece]);
  };

  const onMouseMove = (e, tInfo = null) => {
    if (appMode !== 'BUILD') return;
    e.stopPropagation();
    setTargetInfo(tInfo);

    let myHeight = 0;
    let myWidthX = 1;
    let myDepthZ = 1;

    if (currentGroup) {
        const pivot = currentGroup.blocks[0];
        const baseH = SHAPES[pivot.shape]?.heightBase || 1;
        const pivotScale = getScale(pivot.scale);
        const isRotated = Math.abs(Math.sin(rotation[0])) > 0.5 || Math.abs(Math.sin(rotation[2])) > 0.5;
        myHeight = baseH * pivotScale[1];
        if (isRotated) myHeight = pivotScale[0];
        myWidthX = pivotScale[0];
        myDepthZ = pivotScale[2];
    } else {
        const baseH = SHAPES[currentShape]?.heightBase || 1;
        const isRotated = Math.abs(Math.sin(rotation[0])) > 0.5 || Math.abs(Math.sin(rotation[2])) > 0.5;
        myHeight = baseH * currentScale[1]; 
        if (isRotated) myHeight = currentScale[0];
        const isRotY90 = Math.abs(Math.sin(rotation[1])) > 0.5;
        myWidthX = isRotY90 ? currentScale[2] : currentScale[0];
        myDepthZ = isRotY90 ? currentScale[0] : currentScale[2];
    }

    setGuideSize({x: myWidthX, z: myDepthZ});

    // --- CALCUL POSITION ---
    // X et Z suivent toujours la souris (snap 0.5)
    const normal = e.face.normal;
    // Note: Pour X/Z, on prend le point d'impact direct.
    // Si on est locké, on ignore la normale pour le décalage (on glisse),
    // mais on garde le grid snap.
    
    // Simplification X/Z : Point d'impact pur + centrage ombre
    // Mais attention aux faces latérales.
    // Si lock activé -> On prend juste e.point x/z
    // Si pas lock -> On utilise la normale comme avant
    
    let idealX, idealZ;
    if (lockedY !== null) {
        // En mode Lock, on ignore la normale pour le déplacement latéral,
        // on veut juste suivre la souris sur le plan horizontal
        idealX = e.point.x;
        idealZ = e.point.z;
    } else {
        idealX = e.point.x + (normal.x * (myWidthX/2));
        idealZ = e.point.z + (normal.z * (myDepthZ/2));
    }
    
    const finalX = Math.round(idealX * 2) / 2;
    const finalZ = Math.round(idealZ * 2) / 2;
    
    // --- CALCUL Y (LA MAGIE OPÈRE ICI) ---
    let finalY;

    if (lockedY !== null) {
        // SI LOCK ACTIVÉ : On force la hauteur mémorisée
        finalY = lockedY;
    } else {
        // SINON : Calcul Standard
        const yOffset = myHeight / 2;
        let contactY = 0;

        if (e.object.name === "ground") {
            contactY = 0;
        } else if (tInfo) {
            const n = e.face.normal;
            if (n.y > 0.5) contactY = e.point.y; 
            else if (n.y < -0.5) contactY = tInfo.position[1]; 
            else {
                const neighborCenterY = tInfo.position[1];
                let neighborHeight = 1;
                if (!tInfo.isGroup) {
                    const nBase = SHAPES[tInfo.shape]?.heightBase || 1;
                    neighborHeight = nBase * tInfo.scale[1];
                }
                contactY = neighborCenterY - (neighborHeight / 2);
            }
        }
        
        let calculatedY = contactY + yOffset;
        if (tInfo && e.face.normal.y > 0.5) calculatedY -= 0.002; 
        else calculatedY = Math.round(calculatedY * 4) / 4;
        
        finalY = calculatedY;
    }

    setHoverPos([finalX, finalY, finalZ]);
  };

  const handleSelect = (id) => {
     if (selectedIds.includes(id)) setSelectedIds(prev => prev.filter(pid => pid !== id));
     else setSelectedIds(prev => [...prev, id]);
  };

  return (
    <>
      <ambientLight intensity={0.7} />
      <pointLight position={[10, 20, 10]} intensity={1.5} />
      <Sky sunPosition={[100, 20, 100]} />
      
      <mesh 
        name="ground"
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[0, 0, 0]} 
        onPointerMove={onMouseMove}
        onClick={(e) => { 
            e.stopPropagation(); 
            if (appMode === 'SELECT') { setSelectedIds([]); return; }
            if (e.delta > 2) return;
            if (appMode === 'BUILD' && e.button === 0) addBlock(); 
        }}
      >
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      
      <Grid args={[20, 20]} cellColor="white" sectionColor="gray" infiniteGrid fadeDistance={30} position={[0, 0.01, 0]} />
      <OrbitControls makeDefault />

      {appMode === 'BUILD' && hoverPos && (
          // On passe l'état "isLocked" au guide
          <PlacementGuide position={hoverPos} boxSize={guideSize} isLocked={lockedY !== null} />
      )}
      
      {appMode === 'BUILD' && targetInfo && (
          <FaceHighlighter targetInfo={targetInfo} />
      )}

      {appMode === 'BUILD' && hoverPos && (
        <GhostPiece 
            position={hoverPos} 
            rotation={rotation} 
            shape={currentShape} 
            materialType={currentMat}
            groupData={currentGroup}
            scale={currentScale}
        />
      )}

      {pieces.map((piece) => (
        <Piece 
            key={piece.id} 
            data={piece} 
            appMode={appMode}
            onRemove={(id) => { saveHistory(); setPieces(prev => prev.filter(p => p.id !== id)); }}
            onClickAdd={() => addBlock()} 
            onHover={onMouseMove}
            onGrab={onGrabBlock}
            onSelect={handleSelect}
            isSelected={selectedIds.includes(piece.id)}
        />
      ))}
    </>
  );
}

// --- APP (Reste identique, juste importer Scene mise à jour) ---
export default function App() {
  const [pieces, setPieces] = useState([]);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);

  const saveHistory = useCallback(() => {
    setHistory(prev => {
        const newHist = [...prev, pieces];
        if (newHist.length > 50) newHist.shift(); 
        return newHist;
    });
    setFuture([]); 
  }, [pieces]);

  const undo = useCallback(() => {
      if (history.length === 0) return;
      const previous = history[history.length - 1];
      setFuture(prev => [pieces, ...prev]);
      setPieces(previous);
      setHistory(prev => prev.slice(0, -1));
  }, [history, pieces]);

  const redo = useCallback(() => {
      if (future.length === 0) return;
      const next = future[0];
      setHistory(prev => [...prev, pieces]); 
      setPieces(next);
      setFuture(prev => prev.slice(1));
  }, [future, pieces]);

  useEffect(() => {
      const handleUndoRedoKeys = (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
              if (e.shiftKey) redo(); else undo();
              e.preventDefault();
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
              redo();
              e.preventDefault();
          }
      };
      window.addEventListener('keydown', handleUndoRedoKeys);
      return () => window.removeEventListener('keydown', handleUndoRedoKeys);
  }, [undo, redo]);

  const [currentMat, setCurrentMat] = useState('stone');
  const [currentShape, setCurrentShape] = useState('cube');
  const [rotation, setRotation] = useState([0, 0, 0]);
  const [currentScale, setCurrentScale] = useState([1, 1, 1]); 
  
  const [appMode, setAppMode] = useState('BUILD');
  const [selectedIds, setSelectedIds] = useState([]);
  const [savedGroups, setSavedGroups] = useState([]); 
  const [currentGroup, setCurrentGroup] = useState(null);
  const [showPartList, setShowPartList] = useState(false);
  
  const fileInputRef = useRef(null);

  useEffect(() => {
      const handleGlobalKeys = (e) => {
          if (e.key === 'Escape') { setAppMode('VIEW'); setCurrentGroup(null); setShowPartList(false); }
          if (e.key.toLowerCase() === 'c') setAppMode('BUILD');
          if (e.key.toLowerCase() === 's') setAppMode('SELECT');
          if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
      };
      window.addEventListener('keydown', handleGlobalKeys);
      return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [selectedIds, appMode]);

  const handleGrabBlock = (blockData) => {
    saveHistory();
    setPieces((prev) => prev.filter(p => p.id !== blockData.id));
    if (blockData.isGroup) {
        setCurrentGroup(blockData.structureData);
        setRotation(getRotation(blockData.rotation));
    } else {
        setCurrentMat(blockData.type);
        setCurrentShape(blockData.shape || 'cube');
        setRotation(getRotation(blockData.rotation));
        setCurrentScale(getScale(blockData.scale));
        setCurrentGroup(null);
    }
    setAppMode('BUILD');
  };

  const deleteSelection = () => {
      if (selectedIds.length === 0) return;
      if (confirm(`Supprimer ${selectedIds.length} objets ?`)) {
          saveHistory();
          setPieces(prev => prev.filter(p => !selectedIds.includes(p.id)));
          setSelectedIds([]);
      }
  };

  const createGroup = () => {
      if (selectedIds.length === 0) return;
      const name = prompt("Nom de la structure (ex: Portique) ?");
      if (!name) return;
      const selectedPieces = pieces.filter(p => selectedIds.includes(p.id));
      const hasGroups = selectedPieces.some(p => p.isGroup);
      if (hasGroups) { alert("Impossible de grouper des groupes."); return; }
      
      saveHistory(); 
      selectedPieces.sort((a, b) => a.position[1] - b.position[1]);
      const pivotBlock = selectedPieces[0];
      const blocksData = selectedPieces.map(p => ({
          type: p.type, shape: p.shape, rotation: p.rotation, scale: p.scale,
          relPos: [p.position[0] - pivotBlock.position[0], p.position[1] - pivotBlock.position[1], p.position[2] - pivotBlock.position[2]]
      }));
      const newGroup = { id: uuidv4(), name: name, blocks: blocksData };
      setSavedGroups([...savedGroups, newGroup]);
      setPieces(prev => prev.filter(p => !selectedIds.includes(p.id)));
      setSelectedIds([]);
      setAppMode('BUILD');
      alert(`Structure "${name}" créée !`);
  };

  const selectGroupToPlace = (group) => {
      setCurrentGroup(group);
      setAppMode('BUILD');
  };

  const selectSimpleBlock = (mat, shape) => {
      setCurrentGroup(null);
      if(mat) setCurrentMat(mat);
      if(shape) {
          setCurrentShape(shape);
          if (SHAPES[shape]?.defaultScale) setCurrentScale([...SHAPES[shape].defaultScale]);
      }
  };

  const updateScale = (axis, val) => {
      const newS = [...currentScale];
      newS[axis] = parseFloat(val);
      setCurrentScale(newS);
  };

  const saveTemple = () => {
    const data = JSON.stringify({ pieces, savedGroups });
    const blob = new Blob([data], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `temple-v9-${new Date().toISOString().slice(0,10)}.json`;
    link.click();
  };

  const loadTemple = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try { 
            const data = JSON.parse(ev.target.result);
            if (Array.isArray(data)) setPieces(data);
            else { setPieces(data.pieces || []); setSavedGroups(data.savedGroups || []); }
            setHistory([]); 
            setFuture([]);
        } catch (err) { alert("Erreur fichier"); }
    };
    reader.readAsText(file);
  };

  const partsList = useMemo(() => {
    const inventory = {};
    const addToInventory = (type, shape, scale) => {
        const baseH = SHAPES[shape]?.heightBase || 1;
        const scl = getScale(scale);
        const dimX = scl[0];
        const dimY = baseH * scl[1];
        const dimZ = scl[2];
        const key = `${type}|${shape}|${dimX}x${dimY}x${dimZ}`;
        if (!inventory[key]) {
            inventory[key] = {
                material: MATERIALS[type]?.name || type,
                shapeName: SHAPES[shape]?.name || shape,
                dims: { x: dimX, y: dimY, z: dimZ },
                count: 0
            };
        }
        inventory[key].count++;
    };
    pieces.forEach(p => {
        if (p.isGroup && p.structureData) {
            p.structureData.blocks.forEach(b => addToInventory(b.type, b.shape, b.scale));
        } else {
            addToInventory(p.type, p.shape, p.scale);
        }
    });
    return Object.values(inventory).sort((a, b) => a.material.localeCompare(b.material));
  }, [pieces]);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, background: 'rgba(0,0,0,0.85)', padding: '15px', borderRadius: '8px', color: 'white', maxWidth: '220px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
            <h1 style={{ margin: 0, fontSize: '1.2rem' }}>🏛️ Architecte</h1>
            <span style={{ fontSize: '0.7rem', color: '#888', fontFamily: 'monospace' }}>{APP_VERSION}</span>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '15px' }}>
            <div style={{display:'flex', gap:'5px', marginBottom:'5px'}}>
                 <button onClick={undo} disabled={history.length===0} style={{flex:1, cursor: history.length>0?'pointer':'not-allowed', opacity:history.length>0?1:0.5, padding:'5px', background:'#444', color:'white', border:'none', borderRadius:'4px'}}>↩ Undo</button>
                 <button onClick={redo} disabled={future.length===0} style={{flex:1, cursor: future.length>0?'pointer':'not-allowed', opacity:future.length>0?1:0.5, padding:'5px', background:'#444', color:'white', border:'none', borderRadius:'4px'}}>↪ Redo</button>
            </div>

            <button onClick={() => setAppMode('BUILD')}
            style={{ padding: '8px', cursor: 'pointer', background: appMode === 'BUILD' ? '#4CAF50' : '#444', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}>
            🏗️ CONSTRUCTION (C)
            </button>
            <button onClick={() => setAppMode('SELECT')}
            style={{ padding: '8px', cursor: 'pointer', background: appMode === 'SELECT' ? '#2196F3' : '#444', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}>
            ✨ SÉLECTION (S) {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
            </button>
            <button onClick={() => setAppMode('VIEW')}
            style={{ padding: '8px', cursor: 'pointer', background: appMode === 'VIEW' ? '#9E9E9E' : '#444', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}>
            👀 VUE (Echap)
            </button>
            <button onClick={() => setShowPartList(!showPartList)}
            style={{ padding: '8px', cursor: 'pointer', background: '#FF9800', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', marginTop:'5px' }}>
            📜 LISTE PIÈCES
            </button>
        </div>

        {appMode === 'BUILD' && !currentGroup && (
          <>
            <p style={{fontSize:'0.7rem', margin:'0 0 5px 0', color:'#aaa'}}>MATÉRIAUX</p>
            <div style={{ display: 'flex', gap: '5px', marginBottom: '10px', flexWrap: 'wrap' }}>
              {Object.keys(MATERIALS).map((k) => (
                <button key={k} onClick={() => selectSimpleBlock(k, null)} title={MATERIALS[k].name}
                  style={{ width: '25px', height: '25px', background: MATERIALS[k].color, border: currentMat === k ? '2px solid white' : '1px solid #555', cursor: 'pointer', borderRadius: '4px' }} />
              ))}
            </div>

            <p style={{fontSize:'0.7rem', margin:'0 0 5px 0', color:'#aaa'}}>FORMES</p>
            <div style={{ display: 'flex', gap: '5px', marginBottom: '15px', flexWrap: 'wrap' }}>
                {Object.keys(SHAPES).map((k) => (
                    <button key={k} onClick={() => selectSimpleBlock(null, k)} 
                        style={{ padding:'5px 8px', fontSize:'10px', background: currentShape === k ? '#2196F3' : '#444', color:'white', border:'none', borderRadius:'4px', cursor:'pointer' }}>
                        {SHAPES[k].name}
                    </button>
                ))}
            </div>

            <p style={{fontSize:'0.7rem', margin:'0 0 5px 0', color:'#aaa'}}>DIMENSIONS (L x H x P)</p>
            <div style={{ display: 'flex', gap: '5px', marginBottom: '15px' }}>
                <input type="number" step="0.5" value={currentScale[0]} onChange={(e) => updateScale(0, e.target.value)} 
                    style={{width:'50px', padding:'4px', borderRadius:'4px', border:'none'}} title="Largeur (X)" />
                <input type="number" step="0.5" value={currentScale[1]} onChange={(e) => updateScale(1, e.target.value)} 
                    style={{width:'50px', padding:'4px', borderRadius:'4px', border:'none'}} title="Hauteur (Y)" />
                <input type="number" step="0.5" value={currentScale[2]} onChange={(e) => updateScale(2, e.target.value)} 
                    style={{width:'50px', padding:'4px', borderRadius:'4px', border:'none'}} title="Profondeur (Z)" />
            </div>
            
            <div style={{ fontSize: '0.75rem', color: '#ccc', margin: '5px 0', fontStyle: 'italic' }}>
               <p>🔄 <strong>R</strong> : Pivoter</p>
               <p>🔒 <strong>Shift</strong> : Verrouiller Hauteur</p>
            </div>
          </>
        )}
        
        {/* ... (Sélection / Liste / etc.) ... */}
        {appMode === 'SELECT' && selectedIds.length > 0 && (
            <div style={{ marginBottom: '15px', padding: '10px', background: '#334', borderRadius: '4px' }}>
                <p style={{ margin: '0 0 5px 0', fontSize: '0.8rem' }}>{selectedIds.length} objets sélectionnés</p>
                <button onClick={createGroup} style={{ width: '100%', padding: '5px', marginBottom:'5px', background: '#9C27B0', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight:'bold' }}>
                   💾 Créer Structure
                </button>
                <button onClick={deleteSelection} style={{ width: '100%', padding: '5px', background: '#f44336', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                    Supprimer
                </button>
            </div>
        )}

        {savedGroups.length > 0 && appMode === 'BUILD' && (
             <div style={{ marginBottom: '15px', paddingTop: '10px', borderTop: '1px solid #555' }}>
                <p style={{fontSize:'0.7rem', margin:'0 0 5px 0', color:'#aaa'}}>MES STRUCTURES</p>
                {savedGroups.map(g => (
                    <button key={g.id} onClick={() => selectGroupToPlace(g)}
                        style={{ 
                            display: 'block', width: '100%', textAlign:'left', padding: '6px', marginBottom: '4px', 
                            background: currentGroup?.id === g.id ? '#9C27B0' : '#444', 
                            color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize:'12px' 
                        }}>
                        🏛️ {g.name}
                    </button>
                ))}
                {currentGroup && (
                    <button onClick={() => setCurrentGroup(null)} style={{fontSize:'10px', width:'100%', background:'transparent', border:'1px solid #555', color:'#aaa', cursor:'pointer'}}>
                        (Annuler structure)
                    </button>
                )}
             </div>
        )}

        <div style={{ display: 'flex', gap: '5px', marginTop:'10px', borderTop:'1px solid #444', paddingTop:'10px' }}>
          <button onClick={saveTemple} style={btnStyle('#555')} title="Sauvegarder Projet">💾</button>
          <button onClick={() => fileInputRef.current.click()} style={btnStyle('#555')} title="Charger Projet">📂</button>
          <button onClick={() => { if(confirm("Vider ?")) { saveHistory(); setPieces([]); } }} style={btnStyle('#f44336')} title="Tout effacer">🗑️</button>
        </div>
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={loadTemple} accept=".json" />
      </div>

      {showPartList && (
          <div style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              background: '#222', color: 'white', padding: '20px', borderRadius: '8px',
              zIndex: 20, width: '400px', maxHeight: '80vh', overflowY: 'auto',
              boxShadow: '0 0 20px rgba(0,0,0,0.5)', border: '1px solid #444'
          }}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:'15px'}}>
                  <h2 style={{margin:0, fontSize:'1.2rem'}}>📜 Débit Matériaux</h2>
                  <button onClick={() => setShowPartList(false)} style={{background:'transparent', border:'none', color:'white', fontSize:'1.2rem', cursor:'pointer'}}>✖️</button>
              </div>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:'0.9rem'}}>
                  <thead>
                      <tr style={{borderBottom:'1px solid #555', textAlign:'left'}}>
                          <th style={{padding:'5px'}}>Qte</th>
                          <th style={{padding:'5px'}}>Matériau / Forme</th>
                          <th style={{padding:'5px'}}>Dimensions (cm)</th>
                      </tr>
                  </thead>
                  <tbody>
                      {partsList.map((item, idx) => (
                          <tr key={idx} style={{borderBottom:'1px solid #333'}}>
                              <td style={{padding:'5px', fontWeight:'bold', color:'#FF9800'}}>{item.count}</td>
                              <td style={{padding:'5px'}}>
                                  <span style={{color:'#aaa'}}>{item.material}</span><br/>
                                  {item.shapeName}
                              </td>
                              <td style={{padding:'5px', fontFamily:'monospace'}}>
                                  {item.dims.x} x {item.dims.y} x {item.dims.z}
                              </td>
                          </tr>
                      ))}
                      {partsList.length === 0 && <tr><td colSpan="3" style={{padding:'20px', textAlign:'center', color:'#666'}}>Aucune pièce posée.</td></tr>}
                  </tbody>
              </table>
          </div>
      )}

      <Canvas camera={{ position: [5, 5, 5], fov: 50 }}>
        <Scene 
          pieces={pieces} 
          setPieces={setPieces} 
          saveHistory={saveHistory} 
          currentMat={currentMat} 
          currentShape={currentShape} 
          rotation={rotation}
          setRotation={setRotation}
          currentScale={currentScale}
          appMode={appMode}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          onGrabBlock={handleGrabBlock}
          currentGroup={currentGroup}
        />
      </Canvas>
    </div>
  );
}

const btnStyle = (bg) => ({
  flex: 1, padding: '5px', fontSize: '14px', background: bg, color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer'
});

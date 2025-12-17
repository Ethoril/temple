import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Sky, Grid } from '@react-three/drei';
import { v4 as uuidv4 } from 'uuid';
import * as THREE from 'three';

// --- 0. VERSIONNING ---
const APP_VERSION = "v0.4.0 (Prism & Gravity)";

// --- 1. CONFIGURATION MATÉRIAUX ---
const MATERIALS = {
  stone: { color: '#808080', name: 'Pierre' },
  wood: { color: '#8B4513', name: 'Bois' },
  gold: { color: '#FFD700', name: 'Or' },
  brick: { color: '#A52A2A', name: 'Brique' },
  water: { color: '#4FC3F7', name: 'Eau', opacity: 0.6 },
  grass: { color: '#4CAF50', name: 'Herbe' },
  roof:   { color: '#8B0000', name: 'Tuile' }, // Nouveau pour le toit
};

// --- 2. CONFIGURATION DES FORMES ---
const SHAPES = {
  cube: { name: 'Cube', heightBase: 1 },
  slab: { name: 'Dalle (0.5)', heightBase: 0.5 },
  column: { name: 'Colonne', heightBase: 1 },
  slope: { name: 'Toit (Prisme)', heightBase: 1 }, // Renommé
};

// --- UTILITAIRES ---
const getRotation = (rot) => Array.isArray(rot) ? rot : [0, rot || 0, 0];
const getScale = (s) => Array.isArray(s) ? s : [1, 1, 1];

// --- GÉOMÉTRIE PRISME (TRIANGLE EXTRUDÉ) ---
// On crée une forme sur mesure pour remplacer la pyramide
const createPrismGeometry = () => {
  const shape = new THREE.Shape();
  // On dessine un triangle rectangle vu de profil (1x1)
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(-0.5, 0.5);
  shape.lineTo(-0.5, -0.5); // Fermer la forme

  const extrudeSettings = {
    steps: 1,
    depth: 1, // Profondeur Z de 1
    bevelEnabled: false,
  };

  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  // L'extrusion se fait en Z positif par défaut, on centre l'objet
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
    side: THREE.DoubleSide // Important pour voir l'intérieur du toit si besoin
  });

  // On utilise useMemo pour ne pas recréer la géométrie "Prisme" à chaque frame
  const geometry = useMemo(() => {
    if (shape === 'column') return new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
    if (shape === 'slab') return new THREE.BoxGeometry(1, 0.5, 1);
    // C'EST ICI QUE ÇA CHANGE : Vrai Prisme Triangle
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
          // NOUVEAUTÉ : On envoie tout ce qu'il faut pour calculer le stacking
          // On a besoin de savoir où est le HAUT de l'objet survolé
          // Astuce : On calcule la boite englobante pour trouver le point le plus haut
          onHover(e, {
             position: data.position, // Position du centre de l'objet survolé
             scale: data.isGroup ? [1,1,1] : scl,
             shape: data.isGroup ? 'group' : data.shape,
             rotation: rot
          });
      }
  };

  // CAS GROUPE
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
                        {/* Hitbox locale */}
                        <mesh visible={false} onClick={handleInteraction} onPointerMove={handlePointerMove}>
                            <boxGeometry args={[1 * blockScale[0], finalH, 1 * blockScale[2]]} />
                        </mesh>
                    </group>
                );
            })}
        </group>
      );
  }

  // CAS BLOC SIMPLE
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
      {/* Hitbox */}
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
  currentMat, currentShape, rotation, setRotation, currentScale,
  appMode, selectedIds, setSelectedIds,
  onGrabBlock,
  currentGroup 
}) {
  const [hoverPos, setHoverPos] = useState(null);

  useEffect(() => {
    const handleInput = (e) => {
      if (e.key.toLowerCase() === 'r') setRotation(prev => [prev[0], prev[1] + Math.PI / 2, prev[2]]);
      if (e.key.toLowerCase() === 't') setRotation(prev => [prev[0] + Math.PI / 2, prev[1], prev[2]]);
      if (e.key.toLowerCase() === 'g') setRotation(prev => [prev[0], prev[1], prev[2] + Math.PI / 2]);
    };
    window.addEventListener('keydown', handleInput);
    return () => window.removeEventListener('keydown', handleInput);
  }, [setRotation]);

  useEffect(() => { if (appMode !== 'BUILD') setHoverPos(null); }, [appMode]);

  const addBlock = () => {
    if (!hoverPos || appMode !== 'BUILD') return;

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
        setPieces([...pieces, newGroupPiece]);
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
    setPieces([...pieces, newPiece]);
  };

  // --- NOUVELLE LOGIQUE DE PLACEMENT (GRAVITÉ) ---
  const onMouseMove = (e, targetInfo = null) => {
    if (appMode !== 'BUILD') return;
    e.stopPropagation();

    // 1. Calculer la hauteur PHYSIQUE de l'objet qu'on tient
    // (Pour savoir de combien il faut remonter son centre pour que ses pieds touchent le sol)
    let myHeight = 0;
    
    if (currentGroup) {
        // Pour un groupe, on simplifie : on assume que l'origine relative (0,0,0) est en bas.
        // Si le groupe est centré, il faudrait une BoundingBox. 
        // Par défaut ici : 1.
        myHeight = 1; 
    } else {
        const baseH = SHAPES[currentShape]?.heightBase || 1;
        // On prend le scale Y, mais attention si l'objet est couché (Rotation X ou Z = 90°)
        // Approx simple : si on tourne, les dimensions s'échangent.
        const isRotated = Math.abs(Math.sin(rotation[0])) > 0.5 || Math.abs(Math.sin(rotation[2])) > 0.5;
        // Si on est couché, la hauteur physique devient la largeur ou profondeur (souvent 1 ou scale X/Z)
        // C'est complexe, restons simple :
        myHeight = baseH * currentScale[1]; 
        if (isRotated) myHeight = currentScale[0]; // Approximation si couché
    }

    // Le "Offset" pour que le bas de l'objet soit au point de contact
    const yOffset = myHeight / 2;

    // 2. Définir l'altitude du support (Y du contact)
    let contactY = 0;

    if (e.object.name === "ground") {
        contactY = 0;
    } else if (targetInfo) {
        // On est sur un bloc. Quelle est la hauteur de ce bloc ?
        // targetInfo contient position (centre) et scale.
        // Haut du bloc = Centre Y + (Hauteur / 2)
        // Attention : on doit utiliser la normale pour savoir si on tape le dessus ou le côté.
        
        const normal = e.face.normal;
        
        // Si on tape le DESSUS (Normal Y > 0.5)
        if (normal.y > 0.5) {
             // On s'empile !
             // On doit calculer le Y du haut de la cible.
             // On utilise le point d'impact précis 'e.point.y' qui est exactement sur la surface.
             contactY = e.point.y; 
        } else {
             // On est sur le côté.
             // On veut s'aligner verticalement avec le bloc cible, ou se poser au sol ?
             // Généralement, si on construit sur le flanc, on veut garder le même Y que le voisin
             // OU se poser sur ce qui est en dessous.
             
             // Simplification "Minecraft" :
             // On prend le centre du bloc voisin, et on décale sur la grille.
             // Si on vise le flanc, le Y ne change pas par rapport au voisin.
             // MAIS il faut vérifier si le voisin est posé au sol.
             
             // Utilisons le point d'impact arrondi pour trouver le "Y du sol" local
             // Si je tape le flanc à y=1.5, c'est que je suis en l'air.
             
             // Approche hybride :
             // On prend la coordonnée du centre voisin + direction normale.
             // Et on recalcule le Y pour qu'il "touche le bas".
             
             // REVENONS A PLUS SIMPLE : Utiliser le point d'impact e.point + normale.
             const idealPos = e.point.clone().add(normal.clone().multiplyScalar(0.01));
             // Si on tape le flanc, le Y change peu.
             // Mais on veut recalculer le Y final pour qu'il soit "Bottom Aligned".
             
             // C'est là que c'est dur sans connaitre le sol sous-jacent.
             // On va assumer que si on tape le flanc, on s'aligne sur la grille verticale.
             contactY = Math.floor(idealPos.y); // On snap à l'étage du dessous ?
             
             // NON, plus simple : on s'aligne sur le centre du voisin.
             const neighborCenterY = targetInfo.position[1];
             // Si le voisin est à Y=0.5 (posé au sol), et qu'il fait 1m de haut.
             // Je veux me mettre à côté. Mon bas doit être à 0.
             // Donc mon centre doit être à 0 + myHeight/2.
             
             // Pour généraliser : Le "Plancher" du voisin est (CenterY - NeighborHeight/2).
             // On veut le même plancher.
             let neighborHeight = 1;
             if (!targetInfo.isGroup) {
                 const nBase = SHAPES[targetInfo.shape]?.heightBase || 1;
                 neighborHeight = nBase * targetInfo.scale[1];
             }
             const floorLevel = neighborCenterY - (neighborHeight / 2);
             contactY = floorLevel;
        }
    }

    // 3. Position finale
    // X et Z : on snap sur la grille (Point + normale/2)
    const normal = e.face.normal;
    // On décale le point d'impact d'un demi-cube dans la direction de la normale pour trouver le centre de la case
    // Attention : ça dépend de la taille de MON objet.
    
    // Calcul X/Z du centre
    const idealX = e.point.x + (normal.x * (currentScale[0]/2));
    const idealZ = e.point.z + (normal.z * (currentScale[2]/2));
    
    // Snap X/Z (Grille 0.5)
    const finalX = Math.round(idealX * 2) / 2;
    const finalZ = Math.round(idealZ * 2) / 2;
    
    // Calcul Y Final
    // Centre = ContactY + (MyHeight / 2)
    // On snap le Y résultant pour éviter les flottants bizarres (Grille 0.25)
    const rawY = contactY + yOffset;
    const finalY = Math.round(rawY * 4) / 4;

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
            onRemove={(id) => setPieces(prev => prev.filter(p => p.id !== id))}
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

// --- APP ---
export default function App() {
  const [pieces, setPieces] = useState([]);
  
  const [currentMat, setCurrentMat] = useState('stone');
  const [currentShape, setCurrentShape] = useState('cube');
  const [rotation, setRotation] = useState([0, 0, 0]);
  const [currentScale, setCurrentScale] = useState([1, 1, 1]); 
  
  const [appMode, setAppMode] = useState('BUILD');
  const [selectedIds, setSelectedIds] = useState([]);
  const [savedGroups, setSavedGroups] = useState([]); 
  const [currentGroup, setCurrentGroup] = useState(null); 
  
  const fileInputRef = useRef(null);

  useEffect(() => {
      const handleGlobalKeys = (e) => {
          if (e.key === 'Escape') { setAppMode('VIEW'); setCurrentGroup(null); }
          if (e.key.toLowerCase() === 'c') setAppMode('BUILD');
          if (e.key.toLowerCase() === 's') setAppMode('SELECT');
          if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
      };
      window.addEventListener('keydown', handleGlobalKeys);
      return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [selectedIds, appMode]);

  const handleGrabBlock = (blockData) => {
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

      selectedPieces.sort((a, b) => a.position[1] - b.position[1]);
      const pivotBlock = selectedPieces[0];
      
      const blocksData = selectedPieces.map(p => ({
          type: p.type,
          shape: p.shape,
          rotation: p.rotation,
          scale: p.scale,
          relPos: [
              p.position[0] - pivotBlock.position[0],
              p.position[1] - pivotBlock.position[1],
              p.position[2] - pivotBlock.position[2]
          ]
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
      if(shape) setCurrentShape(shape);
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
    link.download = `temple-v4-${new Date().toISOString().slice(0,10)}.json`;
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
        } catch (err) { alert("Erreur fichier"); }
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, background: 'rgba(0,0,0,0.85)', padding: '15px', borderRadius: '8px', color: 'white', maxWidth: '220px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
            <h1 style={{ margin: 0, fontSize: '1.2rem' }}>🏛️ Architecte</h1>
            <span style={{ fontSize: '0.7rem', color: '#888', fontFamily: 'monospace' }}>{APP_VERSION}</span>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '15px' }}>
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
               <p>🔄 <strong>R</strong> : Pivoter (Y)</p>
               <p>↕️ <strong>T</strong> : Basculer (X)</p>
               <p>↔️ <strong>G</strong> : Basculer (Z)</p>
            </div>
          </>
        )}

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
          <button onClick={() => { if(confirm("Vider ?")) setPieces([]); }} style={btnStyle('#f44336')} title="Tout effacer">🗑️</button>
        </div>
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={loadTemple} accept=".json" />
      </div>

      <Canvas camera={{ position: [5, 5, 5], fov: 50 }}>
        <Scene 
          pieces={pieces} 
          setPieces={setPieces} 
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

import React, { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, TransformControls, Sky, Grid } from '@react-three/drei';
import { v4 as uuidv4 } from 'uuid';

// --- COMPOSANT : UNE PIÈCE UNIQUE ---
function Piece({ position, isSelected, onSelect }) {
  return (
    <mesh 
      position={position} 
      onClick={(e) => {
        e.stopPropagation(); // Empêche le clic de traverser l'objet
        onSelect();
      }}
    >
      {/* Forme du cube (taille 1x1x1) */}
      <boxGeometry args={[1, 1, 1]} /> 
      {/* Couleur : Rose si sélectionné, Orange sinon */}
      <meshStandardMaterial color={isSelected ? "hotpink" : "orange"} />
    </mesh>
  );
}

// --- COMPOSANT : LA SCÈNE 3D ---
function Scene({ pieces, setPieces, selectedId, setSelectedId }) {
  
  // Fonction pour sauvegarder la nouvelle position quand on lâche la souris
  const handleTransformEnd = (e) => {
    if (!selectedId) return;
    const object = e.target.object;
    
    setPieces((prev) => prev.map(p => 
      p.id === selectedId 
        ? { ...p, position: [object.position.x, object.position.y, object.position.z] }
        : p
    ));
  };

  return (
    <>
      {/* Éclairage et Décor */}
      <ambientLight intensity={0.7} />
      <pointLight position={[10, 10, 10]} />
      <Sky sunPosition={[100, 20, 100]} />
      <Grid args={[20, 20]} cellColor="white" sectionColor="gray" infiniteGrid fadeDistance={30} />

      {/* Caméra orbitale (souris pour tourner) */}
      <OrbitControls makeDefault />

      {/* Affichage de toutes les pièces */}
      {pieces.map((piece) => (
        <React.Fragment key={piece.id}>
          {selectedId === piece.id ? (
            // Si la pièce est sélectionnée, on ajoute les flèches de déplacement
            <TransformControls mode="translate" onMouseUp={handleTransformEnd}>
              <Piece 
                position={piece.position} 
                isSelected={true} 
                onSelect={() => setSelectedId(piece.id)} 
              />
            </TransformControls>
          ) : (
            // Sinon, juste la pièce normale
            <Piece 
              position={piece.position} 
              isSelected={false} 
              onSelect={() => setSelectedId(piece.id)} 
            />
          )}
        </React.Fragment>
      ))}
    </>
  );
}

// --- APPLICATION PRINCIPALE ---
export default function App() {
  const [pieces, setPieces] = useState([]); // Liste des pièces
  const [selectedId, setSelectedId] = useState(null); // ID de la pièce sélectionnée

  // Ajouter un cube
  const addPiece = () => {
    const newPiece = {
      id: uuidv4(),
      position: [0, 0.5, 0], // Apparaît au centre
    };
    setPieces([...pieces, newPiece]);
    setSelectedId(newPiece.id);
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      
      {/* MENU (Interface 2D par dessus la 3D) */}
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, background: 'rgba(0,0,0,0.6)', padding: '15px', borderRadius: '8px', color: 'white' }}>
        <h1 style={{ margin: '0 0 10px 0', fontSize: '1.2rem' }}>🏛️ Temple Builder</h1>
        <button 
          onClick={addPiece} 
          style={{ padding: '8px 16px', fontSize: '14px', cursor: 'pointer', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px' }}
        >
          + Ajouter un cube
        </button>
        <div style={{ marginTop: '10px', fontSize: '0.8rem', color: '#ccc' }}>
          <p>🖱️ <strong>Clic Gauche + Glisser</strong> : Tourner la caméra</p>
          <p>🖱️ <strong>Clic Droit + Glisser</strong> : Déplacer la caméra</p>
          <p>🎯 <strong>Clic sur un cube</strong> : Le sélectionner pour le bouger</p>
        </div>
      </div>

      {/* ZONE 3D */}
      <Canvas camera={{ position: [5, 5, 5], fov: 50 }} onPointerMissed={() => setSelectedId(null)}>
        <Scene 
          pieces={pieces} 
          setPieces={setPieces} 
          selectedId={selectedId} 
          setSelectedId={setSelectedId} 
        />
      </Canvas>
    </div>
  );
}
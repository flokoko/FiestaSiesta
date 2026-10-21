import { Component, type ReactNode } from 'react'
import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/** Procedural texture for the cloud balls: smooth, very subtle grain */
function useCloudTexture() {
  return useMemo(() => {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!

    // Base: pure white
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)

    // No warm undertones — keep it pure white
    // Very faint cool-white variation only (subtle surface micro-texture)
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * size
      const y = Math.random() * size
      const r = 2 + Math.random() * 5
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
      grad.addColorStop(0, 'rgba(253,253,253,0.06)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    return texture
  }, [])
}

/** Deformed sphere geometry — irregular, organic, lumpy — soft cloud */
function useCloudGeometry(radius: number) {
  return useMemo(() => {
    const geo = new THREE.SphereGeometry(radius, 64, 64)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()

    // Pseudo-random with seed for consistent deformation
    let seed = 42
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      // Multiple frequency noise for organic lumpy shape
      const n1 = Math.sin(v.x * 8 + v.y * 6) * Math.cos(v.z * 7) * 0.025
      const n2 = Math.sin(v.y * 12 + v.z * 10) * Math.cos(v.x * 9) * 0.015
      const n3 = (rand() - 0.5) * 0.02
      const deform = 1 + n1 + n2 + n3
      v.multiplyScalar(deform)
      pos.setXYZ(i, v.x, v.y, v.z)
    }

    geo.computeVertexNormals()
    return geo
  }, [radius])
}

/** Single 3D cloud ball with realistic material */
function CloudBall({
  radius = 0.35,
}: {
  radius?: number
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const texture = useCloudTexture()
  const geometry = useCloudGeometry(radius)

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.8
    }
  })

  return (
    <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
      <meshPhysicalMaterial
        color="#f8f9fb"
        roughness={0.3}
        metalness={0.0}
        clearcoat={0.6}
        clearcoatRoughness={0.2}
        sheen={1.0}
        sheenColor="#ffffff"
        sheenRoughness={0.15}
        map={texture}
        transparent
        opacity={1.0}
        envMapIntensity={1.0}
      />
    </mesh>
  )
}

/** Orbiting ball that circles the center on a tilted plane */
function OrbitingBall({
  orbitRadius,
  speed,
  tiltX,
  tiltZ,
  offset = 0,
}: {
  orbitRadius: number
  speed: number
  tiltX: number
  tiltZ: number
  offset?: number
}) {
  const groupRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (groupRef.current) {
      const t = state.clock.elapsedTime * speed + offset
      // Base circular orbit in XZ plane
      const x = Math.cos(t) * orbitRadius
      const z = Math.sin(t) * orbitRadius
      // Tilt the orbit plane
      groupRef.current.position.x = x * Math.cos(tiltZ) - z * Math.sin(tiltZ)
      groupRef.current.position.z = x * Math.sin(tiltZ) + z * Math.cos(tiltZ)
      groupRef.current.position.y = Math.sin(t) * orbitRadius * Math.sin(tiltX)
    }
  })

  return (
    <group ref={groupRef}>
      <CloudBall />
    </group>
  )
}

/** Inner scene content — extracted so error boundary wraps the Canvas */
function SceneContent() {
  return (
    <>
      {/* Lighting — Alpinaweiß: high ambient for bright base, cool directional for crisp shadows */}
      <ambientLight intensity={0.85} color="#f0f4ff" />
      <directionalLight
        position={[3, 4, 3]}
        intensity={1.2}
        color="#ffffff"
        castShadow
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
      />
      {/* Fill light from opposite side — lifts shadows so balls stay bright */}
      <directionalLight position={[-3, 2, -2]} intensity={0.5} color="#e8eeff" />
      <pointLight position={[-3, -2, 2]} intensity={0.3} color="#ffffff" />

      {/* Two orbiting cloud balls on different orbital planes */}
      <OrbitingBall orbitRadius={1.8} speed={2.5} tiltX={Math.PI / 3} tiltZ={0} offset={0} />
      <OrbitingBall orbitRadius={1.8} speed={2.5} tiltX={Math.PI / 3} tiltZ={Math.PI / 2} offset={Math.PI} />
    </>
  )
}

/**
 * Error boundary that silently catches WebGL context loss during unmount.
 * This prevents the Three.js Canvas teardown from crashing the parent React tree.
 */
class WebGLErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    // WebGL context loss during unmount is expected — suppress silently
    const msg = error?.message?.toLowerCase() || ''
    if (msg.includes('webgl') || msg.includes('context') || msg.includes('canvas')) {
      return
    }
    console.warn('SiestaScene error:', error)
  }

  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

export default function SiestaScene({ fullscreen }: { fullscreen?: boolean }) {
  return (
    <WebGLErrorBoundary>
      <Canvas
        camera={{ position: [0, 0.5, fullscreen ? 8 : 5], fov: fullscreen ? 55 : 50 }}
        style={fullscreen ? { width: '100%', height: '100%', pointerEvents: 'none' } : { width: 220, height: 220 }}
        shadows
        dpr={[1, 2]}
      >
        <SceneContent />
      </Canvas>
    </WebGLErrorBoundary>
  )
}

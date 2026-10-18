import * as THREE from 'three'

type Resource = { dispose(): void }
function resourcesOf(roots: readonly THREE.Object3D[], extra: readonly Resource[]): Set<Resource> {
  const resources = new Set(extra)
  for (const root of roots) root.traverse(object => {
    const renderable = object as THREE.Mesh
    if (renderable.geometry) resources.add(renderable.geometry)
    const materials = Array.isArray(renderable.material) ? renderable.material : renderable.material ? [renderable.material] : []
    for (const material of materials) {
      resources.add(material)
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) resources.add(value)
    }
  })
  return resources
}

/** Release removed trees now, not by retaining every demolished prefab until
 * route teardown. Shared asset templates, live trees, and resource pools remain
 * protected. Called on structural removal/teardown, never in the frame loop.
 */
export function disposeSceneTrees(roots: readonly THREE.Object3D[], extra: readonly Resource[] = [], keepRoots: readonly THREE.Object3D[] = [], keepExtra: readonly Resource[] = []): void {
  const protectedResources = resourcesOf(keepRoots, keepExtra)
  for (const resource of resourcesOf(roots, extra)) if (!protectedResources.has(resource)) resource.dispose()
}

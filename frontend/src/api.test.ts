import { describe, expect, it } from 'vitest'
import { meshUrl } from './api'

describe('meshUrl', () => {
  it('loads room meshes from the room folder', () => {
    expect(meshUrl('lounge', 'meshes/sofa.glb')).toBe('/files/lounge/meshes/sofa.glb')
  })

  it('loads catalog meshes from the catalog files', () => {
    expect(meshUrl('lounge', 'catalog/models/kallax-desk.glb')).toBe('/api/catalog/files/models/kallax-desk.glb')
  })

  it('encodes path pieces', () => {
    expect(meshUrl('my room', 'meshes/a b.glb')).toBe('/files/my%20room/meshes/a%20b.glb')
  })
})

import { describe, expect, it } from 'vitest'
import { catalogFileUrl, meshUrl } from './api'

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

  it('uses an uploaded model as it is', () => {
    expect(meshUrl('lounge', '/api/custom/files/custom-ab12.glb')).toBe('/api/custom/files/custom-ab12.glb')
  })
})

describe('catalogFileUrl', () => {
  it('points a catalog path at the catalog files', () => {
    expect(catalogFileUrl('photos/a b.jpg')).toBe('/api/catalog/files/photos/a%20b.jpg')
  })

  it('uses an uploaded photo as it is', () => {
    expect(catalogFileUrl('/api/custom/files/custom-ab12.jpg')).toBe('/api/custom/files/custom-ab12.jpg')
  })
})

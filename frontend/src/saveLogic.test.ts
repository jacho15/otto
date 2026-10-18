import { describe, expect, it, vi } from 'vitest'
import { drainQueue, mergeServerObjects, queueChange } from './saveLogic'
import type { Change } from './saveLogic'
import type { Room, RoomObject } from './types'

const obj = (name: string, x = 0): RoomObject => ({
  name,
  label: name,
  mesh: '',
  pos: [x, 0, 0],
  yaw: 0,
  size: [1, 1, 1],
  movable: true,
  rgba: [1, 1, 1, 1],
})
const room = (objects: RoomObject[]) => ({ objects }) as Room

describe('mergeServerObjects', () => {
  it('keeps an object deleted locally while another patch was in flight', () => {
    const local = [obj('b', 1)]
    const server = [obj('a'), obj('b', 5)]
    expect(mergeServerObjects(local, server, null, new Set()).map((o) => o.name)).toEqual(['b'])
  })

  it('keeps local state for dragged and pending pieces, server state otherwise', () => {
    const local = [obj('a', 1), obj('b', 2), obj('c', 3)]
    const server = [obj('a', 9), obj('b', 9), obj('c', 9)]
    const out = mergeServerObjects(local, server, 'a', new Set(['b']))
    expect(out.map((o) => o.pos[0])).toEqual([1, 2, 9])
  })

  it('adds the server-added object, and no other unknown one', () => {
    const local = [obj('a')]
    const server = [obj('a'), obj('new'), obj('gone')]
    expect(mergeServerObjects(local, server, null, new Set(), 'new').map((o) => o.name)).toEqual(['a', 'new'])
  })

  it('does not duplicate the added object if it is already local', () => {
    const local = [obj('a'), obj('new')]
    const server = [obj('a'), obj('new', 5)]
    const out = mergeServerObjects(local, server, null, new Set(), 'new')
    expect(out.map((o) => o.name)).toEqual(['a', 'new'])
    expect(out[1].pos[0]).toBe(5)
  })

  it('takes the hidden flag from the server, including for dragged and pending pieces', () => {
    const local = [obj('a', 1), obj('b', 2), obj('c', 3)]
    const server = [{ ...obj('a', 9), hidden: true }, { ...obj('b', 9), hidden: true }, { ...obj('c', 9), hidden: true }]
    const out = mergeServerObjects(local, server, 'a', new Set(['b']))
    expect(out.map((o) => [o.pos[0], o.hidden])).toEqual([[1, true], [2, true], [9, true]])
  })

  it('shows an original again once the server drops its hidden flag', () => {
    const local = [{ ...obj('a'), hidden: true }, { ...obj('b'), hidden: true }]
    const server = [obj('a'), obj('b')]
    const out = mergeServerObjects(local, server, null, new Set(['b']))
    expect(out.map((o) => !!o.hidden)).toEqual([false, false])
  })
})

describe('queueChange', () => {
  it('latest pending change per object wins', () => {
    const q = new Map<string, Change>()
    queueChange(q, 'a', { pos: [1, 1] })
    queueChange(q, 'a', { pos: [2, 2] })
    queueChange(q, 'a', { yaw: 1 })
    expect(q.get('a')).toEqual({ pos: [2, 2], yaw: 1 })
  })

  it('delete wins over a pending move, and over a later move', () => {
    const q = new Map<string, Change>()
    queueChange(q, 'a', { pos: [1, 1] })
    queueChange(q, 'a', { remove: true })
    queueChange(q, 'a', { pos: [3, 3] })
    expect(q.get('a')).toEqual({ remove: true })
  })
})

describe('drainQueue', () => {
  it('sends each change and reports names still queued', async () => {
    const q = new Map<string, Change>()
    queueChange(q, 'a', { yaw: 1 })
    queueChange(q, 'b', { yaw: 2 })
    const onResult = vi.fn()
    await drainQueue(q, async () => room([]), onResult, vi.fn())
    expect(onResult.mock.calls.map((c) => [...c[1]])).toEqual([['b'], []])
  })

  it('calls the failure callback and drops the rest of the queue', async () => {
    const q = new Map<string, Change>()
    queueChange(q, 'a', { yaw: 1 })
    queueChange(q, 'b', { yaw: 2 })
    const send = vi.fn().mockRejectedValue(new Error('boom'))
    const onFail = vi.fn()
    await drainQueue(q, send, vi.fn(), onFail)
    expect(onFail).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(q.size).toBe(0)
  })
})

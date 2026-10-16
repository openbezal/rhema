import { beforeEach, expect, it, vi } from "vitest"
beforeEach(() => vi.resetModules())

it("takes one synchronous lease and invalidates previous operator work across release", async () => {
  const maintenance = await import("./operator-maintenance")
  const previous = maintenance.operatorRevision()
  const lease = maintenance.beginOperatorMaintenance()
  expect(maintenance.isOperatorWorkCurrent(previous)).toBe(false)
  expect(maintenance.isOperatorMaintenanceActive()).toBe(true)
  expect(() => maintenance.beginOperatorMaintenance()).toThrow("already")
  lease.commitPhase()
  expect(maintenance.useOperatorMaintenanceStore.getState().phase).toBe(
    "committing"
  )
  lease.release()
  expect(maintenance.isOperatorMaintenanceActive()).toBe(false)
  expect(maintenance.isOperatorWorkCurrent(previous)).toBe(false)
  expect(
    maintenance.isOperatorWorkCurrent(maintenance.operatorRevision())
  ).toBe(true)
  lease.release()
  expect(maintenance.isOperatorMaintenanceActive()).toBe(false)
})

it("disconnects app consumers synchronously and reconnects only after safe release", async () => {
  const maintenance = await import("./operator-maintenance")
  const stop = vi.fn()
  const connect = vi.fn(() => stop)
  const disconnect = maintenance.connectOutsideMaintenance(connect)
  expect(connect).toHaveBeenCalledTimes(1)
  const lease = maintenance.beginOperatorMaintenance()
  expect(stop).toHaveBeenCalledTimes(1)
  lease.commitPhase()
  expect(connect).toHaveBeenCalledTimes(1)
  lease.release()
  expect(connect).toHaveBeenCalledTimes(2)
  disconnect()
  expect(stop).toHaveBeenCalledTimes(2)
  const another = maintenance.beginOperatorMaintenance()
  another.release()
  expect(connect).toHaveBeenCalledTimes(2)
})

it("keeps consumers and operator actions blocked when the commit outcome is uncertain", async () => {
  const maintenance = await import("./operator-maintenance")
  const connect = vi.fn(() => vi.fn())
  const disconnect = maintenance.connectOutsideMaintenance(connect)
  const lease = maintenance.beginOperatorMaintenance()
  lease.recoveryRequired("Reload Rhema to recover the saved profile")
  lease.release()
  expect(maintenance.useOperatorMaintenanceStore.getState()).toMatchObject({
    phase: "recovery",
    message: "Reload Rhema to recover the saved profile",
  })
  expect(maintenance.isOperatorMaintenanceActive()).toBe(true)
  expect(connect).toHaveBeenCalledTimes(1)
  expect(() => maintenance.beginOperatorMaintenance()).toThrow()
  disconnect()
})

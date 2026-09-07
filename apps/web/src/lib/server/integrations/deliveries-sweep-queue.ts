import { sweepIntegrationDeliveries } from './app-hook-handler'
export async function runDeliveriesSweep() {
  await sweepIntegrationDeliveries()
}

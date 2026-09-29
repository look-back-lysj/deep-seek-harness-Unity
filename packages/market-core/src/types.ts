/**
 * Client-safe contract surface. Runtime packages must not import Host modules
 * through this file; it only re-exports stable wire types and constants.
 */
export type * from './contracts/types.ts'
export { MARKET_SCHEMA_VERSION, PROTOCOL_VERSION, SERVICE_NAME } from './contracts/types.ts'

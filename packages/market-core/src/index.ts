/** 浏览器安全入口：导入合同不会加载 Node、DSH 或创建任何运行时。 */
export * from './contracts/types.ts'
export { CORE_API_VERSION, CORE_VERSION, supportsApiVersion } from './contracts/compatibility.ts'
export type { MarketBackend } from './api.ts'

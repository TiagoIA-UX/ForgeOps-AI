export function createDomainLogger(domain: string) {
  const prefix = `[${domain.toUpperCase()}]`
  return {
    info: (msg: string, ...args: unknown[]) => console.info(prefix, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(prefix, msg, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(prefix, msg, ...args),
  }
}

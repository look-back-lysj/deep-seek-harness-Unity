declare module '@deepseek-ai/dsh-typert-protocol' {
  export function bindTypertRemote<Service extends object>(
    service: Service,
    serviceKey: string,
    options?: { readonly namespace?: string },
  ): { readonly service: Service; readonly serviceKey: string; readonly namespace: string }

  export function Remote<This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ): void

  export function Remote(option: string | { readonly mode: 'stream' }):
    <This extends object, Args extends unknown[], Result>(
      method: (this: This, ...args: Args) => Result,
      context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
    ) => void

  export function RemoteScope(key: string, exportName?: string):
    <This extends object, Args extends unknown[], Result>(
      method: (this: This, ...args: Args) => Result,
      context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
    ) => void
}

/**
 * Client entry: mount the generated Remote contribution, then register one
 * global EAC main panel and one sidebar entry. All cleanup is explicit.
 */
import { createElement, type ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { Context } from '@deepseek-ai/cordis'
import { activateMarketClient, type Disposer } from './activation.ts'
import { MarketPage } from './MarketPage.tsx'
import { TYPERT_REMOTE } from '@dsh-eac/market/remote'

export { PANEL_ID } from './activation.ts'
export const inject = ['remote', 'slots', 'locale', 'layout']

function Icon(): ReactNode {
  return createElement('span', { 'aria-hidden': true }, 'E')
}

export async function apply(ctx: Context): Promise<Disposer> {
  return activateMarketClient(ctx, TYPERT_REMOTE, { MarketPage, Icon })
}

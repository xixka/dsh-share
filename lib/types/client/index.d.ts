import type { Context } from '@deepseek-ai/cordis';
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store';
import type { LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type ReactElement } from 'react';
import { type ShareRuntime, type ShareSelectionSnapshot } from './runtime.ts';
export declare const name = "dsh-share/client";
export declare const inject: string[];
interface ShareRuntimeInjected {
    hooks: {
        shareLocale: ObservableSnapshot<LocaleSnapshot>;
        shareSelection: ObservableSnapshot<ShareSelectionSnapshot>;
    };
    shareRuntime: ShareRuntime;
}
export type ShareActionProps = PropsRuntime<'conversation.chat.assistant-actions'> & InjectFace<ShareRuntimeInjected>;
/** 官方 assistant-actions 插槽中的分享入口。 */
export declare function ShareAction({ sessionId, shareRuntime, useShareLocale, useSessions, }: ShareActionProps): ReactElement;
export declare function apply(ctx: Context): void;
export { createShareCard } from './card.ts';
export { createShareMarkdown } from './markdown.ts';
export { findTurnContent, findTurnContentFromAction } from './dom.ts';
export { renderShareImage, type ImageRenderer } from './preview-dialog.ts';
export { createShareRuntime, type InstallOptions, type ShareRuntime, type ShareSelectionSnapshot, } from './runtime.ts';
export { DEFAULT_SHARE_SETTINGS, FONT_SIZE_PRESETS, loadShareSettings, saveShareSettings, WIDTH_PRESETS, type FontSizePreset, type ShareSettings, type WidthPreset, } from './settings.ts';
//# sourceMappingURL=index.d.ts.map
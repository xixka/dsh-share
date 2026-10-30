import { type ShareSettings } from './settings.ts';
/** 将 GenUI 的已渲染内容静态化，避免独立 HTML/Markdown 丢失组件样式、SVG 和画布。 */
export declare function replaceGenuiWithImages(root: HTMLElement, locale: 'zh' | 'en', settings: ShareSettings): Promise<void>;
//# sourceMappingURL=static-genui.d.ts.map
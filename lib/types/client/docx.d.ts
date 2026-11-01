import type { ShareMessage } from './content.ts';
import type { ShareSettings } from './settings.ts';
/** 将与图片相同的可见内容导出为可编辑 DOCX。 */
export declare function createShareDocx(document: Document, messages: readonly ShareMessage[], locale: 'zh' | 'en', settings: ShareSettings): Promise<Blob>;
/** 下载 DOCX，命名与其它导出一致。 */
export declare function downloadDocxFile(document: Document, blob: Blob, title?: string): void;
export declare const DOCX_BODY_COLOR = "1F2329";
export declare const DOCX_HALF_POINTS: Record<string, number>;
//# sourceMappingURL=docx.d.ts.map
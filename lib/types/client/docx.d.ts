import type { ShareMessage } from './content.ts';
import type { ShareSettings } from './settings.ts';
/** 将与图片相同的可见内容导出为可编辑 DOCX。 */
export declare function createShareDocx(document: Document, messages: readonly ShareMessage[], locale: 'zh' | 'en', settings: ShareSettings): Promise<Blob>;
/**
 * 把分页 PNG 嵌入为可编辑 Word 文档：每页一张居中图片，页与页之间可插入文字。
 * 视觉与导出图片一致（嵌入的就是那些 PNG），文档本身可编辑、可复制。
 */
export declare function createPagesDocx(pages: readonly Blob[], title?: string, now?: Date, signal?: AbortSignal): Promise<Blob>;
/** 下载 DOCX，命名与其它导出一致。 */
export declare function downloadDocxFile(document: Document, blob: Blob, title?: string): void;
export declare const DOCX_BODY_COLOR = "1F2329";
export declare const DOCX_HALF_POINTS: Record<string, number>;
//# sourceMappingURL=docx.d.ts.map
import { type ShareLocale } from './i18n.ts';
import { type ShareSettings } from './settings.ts';
/** 导出前预取卡片图片：成功的转成 data URL 内联（渲染器跳过、不再二次请求），失败项替换为可见占位并计数。 */
export declare function markUnembeddableImages(card: HTMLElement, locale: 'zh' | 'en'): Promise<number>;
/** 弹窗图片格式下拉的可选产物。 */
export type ImageDownloadFormat = 'png' | 'zip' | 'pdf' | 'docx';
export type ImageRenderer = (element: HTMLElement) => Promise<Blob | Blob[]>;
export declare function renderShareImage(element: HTMLElement): Promise<Blob | Blob[]>;
/** PDF 导出走同一渲染管线：先渲染为分页 PNG，再原样装配成单文件 PDF。 */
export declare function renderSharePdf(element: HTMLElement, title?: string, now?: Date): Promise<Blob>;
export declare function downloadMarkdownFile(document: Document, markdown: string, title?: string): void;
/** 下载独立HTML文档，给宿主留出读取Blob的时间。 */
export declare function downloadHtmlFile(document: Document, html: string, title?: string): void;
interface PreviewDialogOptions {
    getConversationTitle?(): string | undefined;
    getLocale(): ShareLocale;
    onSettingsChange(settings: ShareSettings): void;
    onDismiss(): void;
    /** 与预览同一渲染管线生成 PDF；由运行时注入以复用卡片构建逻辑。 */
    renderPdf(content: readonly unknown[], locale: ShareLocale): Promise<Blob>;
}
export declare class PreviewDialog {
    private readonly document;
    private readonly options;
    readonly element: HTMLDialogElement;
    private readonly title;
    private readonly image;
    private readonly message;
    private readonly status;
    private readonly copyButton;
    private readonly downloadButton;
    private readonly imageFormatSelect;
    private readonly downloadAllButton;
    private readonly directSingleTurnInput;
    private readonly hideProcessInput;
    private readonly choiceButtons;
    private readonly storage?;
    private currentSettings;
    private currentDirectSingleTurn;
    private blob?;
    private objectUrl?;
    private pages;
    private pageUrls;
    private pageIndex;
    private missingImages;
    private archiveJob?;
    private readonly pager;
    private readonly previousPage;
    private readonly nextPage;
    private readonly pageLabel;
    constructor(document: Document, options: PreviewDialogOptions);
    get settings(): ShareSettings;
    get directSingleTurn(): boolean;
    /**
     * PDF 导出的统一入口：由运行时提供与弹窗一致的渲染管线回调，
     * 避免把卡片构建和 GenUI 静态化逻辑复制到两处。
     */
    renderPagesForPdf(content: readonly unknown[], locale: ShareLocale): Promise<Blob>;
    /** 弹窗会跨语言切换复用；每次显示前都从 DSH 官方 locale 刷新静态文案。 */
    private updateCopy;
    showLoading(turnCount: number, preservePreview?: boolean, selectionExport?: boolean): void;
    /** 设置连续变化时先保留当前预览，只更新轻量状态；图片稍后统一重算。 */
    showPendingUpdate(): void;
    /** 先在独立 img 中完成解码，再原位替换当前预览，避免出现空白帧。 */
    showResult(result: Blob | Blob[], isCurrent?: () => boolean, missingImages?: number): Promise<boolean>;
    private selectPage;
    showError(preservePreview?: boolean): void;
    /** 图片无法内嵌时在状态行常驻提示，翻页也保留。 */
    private applyMissingImagesHint;
    private waitForImage;
    private nextFrame;
    destroy(): void;
    private open;
    private close;
    private createChoice;
    private updateControlState;
    private clearResult;
    private clearImageResult;
    private copy;
    private download;
    private cancelArchive;
    /** 图片格式下拉统一分发：当前页 PNG / 全部页 ZIP / PDF / Word。 */
    private downloadImage;
    /** 把当前全部分页装配为单文件 DOCX；内容与图片一致且可编辑。 */
    private downloadDocx;
    /** 把当前全部分页装配为单文件 PDF；页面即预览中的 PNG，观感逐像素一致。 */
    private downloadPdf;
    /** 一次保存全部分页，避免多次自动下载被宿主丢弃。 */
    private downloadAll;
}
export {};
//# sourceMappingURL=preview-dialog.d.ts.map
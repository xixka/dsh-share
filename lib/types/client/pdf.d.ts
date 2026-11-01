/** 把分页 PNG 装配为单文件 PDF；单页同样生成，保证格式选择行为一致。 */
export declare function createPagesPdf(pages: readonly Blob[], title?: string, now?: Date, signal?: AbortSignal): Promise<Blob>;
/** 下载装配好的 PDF，命名与 PNG/HTML 导出一致。 */
export declare function downloadPdfFile(document: Document, blob: Blob, title?: string): void;
//# sourceMappingURL=pdf.d.ts.map
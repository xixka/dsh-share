/** DOCX/其他 XML 部件共用的 XML 转义。 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // 控制字符在 XML 1.0 中非法；Word 打开含控制符文档会直接报错。
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

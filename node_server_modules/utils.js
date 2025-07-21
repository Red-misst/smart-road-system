// utils.js
export function isBinaryData(data) {
  if (data instanceof Buffer) return true;
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) return true;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return true;
  if (typeof data === 'string') {
    if (data.startsWith('\xFF\xD8\xFF'))
    if (data.startsWith('GIF87a') || data.startsWith('GIF89a'))
    if (data.startsWith('\x89PNG\r\n\x1A\n'))
  }
  return false;
}
export function isJpegData(data) {
  if (data instanceof Buffer) {
    return data.length >= 3 && 
           data[0] === 0xFF && 
           data[1] === 0xD8 && 
           data[2] === 0xFF;
  }
  return false;
}

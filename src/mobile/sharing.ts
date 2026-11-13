export function publicWorkLink(id: string, gallery: boolean) {
  if (!/^[1-9]\d{15,19}$/.test(id)) throw new Error('作品 ID 无效。');
  return `https://www.douyin.com/${gallery ? 'note' : 'video'}/${id}`;
}
export function shareText(title: string, link: string) { return `${title.trim().slice(0, 160) || '抖音作品'}\n${link}`; }

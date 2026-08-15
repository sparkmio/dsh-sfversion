/**
 * 将图片请求拆分为内容描述、空间定位和 UI 还原三类视觉任务。
 * 此模块保持无宿主运行时依赖，方便在文档解析与发布 CI 中独立测试。
 */
export function classifyVisionMode(query) {
  const q = typeof query === 'string' ? query.trim() : ''
  const grounding = /(哪里|在哪|位置|位于|左上|右上|左下|右下|上方|下方|左侧|右侧|旁边|附近|坐标|区域|角落|中心|中间|几成|百分比位置)/i.test(q)
  const restore = /(还原|HTML|网页|前端|页面代码|原型|UI\s*复刻|界面代码|生成网站)/i.test(q)
  const strongRestore = /(还原|HTML|网页代码|页面代码|前端代码|UI\s*复刻|界面代码|生成(?:完整|一个|这个)?(?:网站|网页|页面|HTML|前端))/i.test(q)
  if (grounding && !strongRestore) return { describe: false, ground: true, restore: false }
  if (restore) return { describe: true, ground: false, restore: true }
  if (grounding) return { describe: false, ground: true, restore: false }
  return { describe: true, ground: false, restore: false }
}
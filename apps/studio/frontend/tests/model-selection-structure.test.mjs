import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readEpisodeWorkbench } from './_episode.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const page = readEpisodeWorkbench()
const useAgent = read('app/composables/useAgent.ts')
const useApi = read('app/composables/useApi.ts')

test('workbench offers model selectors for rewrite, image and video generation', () => {
  // 三个选择器（自定义 ModelSelect 弹窗组件，非原生 select）
  assert.match(page, /<ModelSelect/)
  assert.match(page, /v-model="chatModel"/)
  assert.match(page, /v-model="imageModel"/)
  assert.match(page, /v-model="videoModel"/)
  assert.doesNotMatch(page, /<select v-model="chatModel"/)
  // 选项汇总该类型全部启用配置的模型（去重、按优先级），API 返回的 model 可能已是数组
  assert.match(page, /function collectModelOptions\(cfgs\)/)
  assert.match(page, /if \(Array\.isArray\(raw\)\) return raw\.filter\(Boolean\)/)
  assert.match(page, /collectModelOptions\(textConfigs\.value\)/)
  assert.match(page, /collectModelOptions\(imageConfigs\.value\)/)
  assert.match(page, /collectModelOptions\(videoConfigs\.value\)/)
  assert.match(page, /aiConfigAPI\.list\('text'\)/)
})

test('model select dropdown is a custom popover built on AppMenu', () => {
  const component = read('app/components/ModelSelect.vue')
  const appMenu = read('app/components/AppMenu.vue')

  // Teleport + positioning กลางอยู่ที่ AppMenu (ModelSelect ใช้ AppMenu เป็นแท่น popup)
  assert.match(appMenu, /Teleport to="body"/)
  assert.match(component, /<AppMenu/)
  assert.match(component, /model-select-trigger/)
  assert.match(component, /<AppMenuItem/)
  assert.match(component, /:selected="modelValue ===/)
  assert.match(component, /emit\('update:modelValue', model\)/)
  // 多配置时展示来源配置名
  assert.match(component, /showConfig/)
})

test('selected models are sent with rewrite, image and video generation requests', () => {
  // 选中模型时连同其所属配置一起调用
  assert.match(page, /function ownerConfigId\(options, key\)/)
  // 改写（Agent）透传模型与配置
  assert.match(useAgent, /model: model \|\| undefined/)
  assert.match(useAgent, /config_id: configId \|\| undefined/)
  assert.match(page, /runAgent\('script_rewriter'[\s\S]*?chatModelOverride\(\), chatConfigId\(\)\)/)
  // 图片生成透传模型与配置
  assert.match(useApi, /generateImage: \(id: number, episodeId: number, model\?: string, configId\?: number, textModel\?: string, textConfigId\?: number\)/)
  // 文本模型覆盖随生图/提取请求透传（缺提示词时后端触发提示词 Agent）
  assert.match(useApi, /text_model: textModel \|\| undefined/)
  assert.match(useApi, /text_config_id: textConfigId \|\| undefined/)
  assert.match(useApi, /config_id: configId \|\| undefined/)
  // one path for character / scene / prop images (genAssetImage) and for the scene / prop batches
  assert.match(page, /genAssetImage\('character', id, characterAPI,/)
  assert.match(page, /genAssetImage\('scene', id, sceneAPI,/)
  assert.match(page, /api\.generateImage\(id, epId\.value, bareModelName\(imageModel\.value\) \|\| undefined, ownerConfigId\(imageModelOptions\.value, imageModel\.value\), chatModelOverride\(\), chatConfigId\(\)\)/)
  assert.match(page, /characterAPI\.batchImages\(ids, epId\.value, bareModelName\(imageModel\.value\) \|\| undefined, ownerConfigId\(imageModelOptions\.value, imageModel\.value\), chatModelOverride\(\), chatConfigId\(\)\)/)
  // 视频生成透传模型与配置
  assert.match(page, /model: bareModelName\(videoModel\.value\) \|\| undefined/)
  assert.match(page, /config_id: ownerConfigId\(videoModelOptions\.value, videoModel\.value\)/)
})

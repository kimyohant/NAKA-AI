<template>
  <div class="mx-builder">
    <!-- Hooks สำรอง (ไม่เลือก = ใช้ hook เดิมของ blueprint) -->
    <div class="mx-group" v-if="hookOptions.length">
      <p class="mx-label">{{ t('viralClone.variants.hooksLabel') }}</p>
      <div class="mx-chips">
        <button
          v-for="(opt, i) in hookOptions" :key="`hook-${i}`" type="button"
          class="mx-chip" :class="{ on: hookIdx.includes(i) }"
          :aria-pressed="hookIdx.includes(i)"
          :title="opt"
          @click="toggle(hookIdx, i)"
        >
          <span class="mx-chip-name">Hook #{{ i + 1 }}</span>
          <span class="mx-chip-sub">{{ opt }}</span>
        </button>
      </div>
    </div>

    <!-- สินค้า (จาก Product Studio) -->
    <div class="mx-group">
      <p class="mx-label">{{ t('viralClone.variants.productsLabel') }}</p>
      <div v-if="products.length" class="mx-chips">
        <button
          v-for="p in products" :key="`p-${p.id}`" type="button"
          class="mx-chip" :class="{ on: productIds.includes(p.id) }"
          :aria-pressed="productIds.includes(p.id)"
          @click="toggle(productIds, p.id)"
        >
          <img v-if="p.productImages?.[0]" :src="p.productImages[0]" alt="" loading="lazy" />
          <Package v-else :size="13" :stroke-width="1.8" />
          <span class="mx-chip-name">{{ p.title || p.productName }}</span>
        </button>
      </div>
      <p v-else class="mx-empty">{{ t('viralClone.variants.productsEmpty') }}</p>
    </div>

    <!-- Avatar -->
    <div class="mx-group">
      <p class="mx-label">{{ t('viralClone.variants.avatarsLabel') }}</p>
      <div v-if="avatars.length" class="mx-chips">
        <button
          v-for="a in avatars" :key="`a-${a.id}`" type="button"
          class="mx-chip" :class="{ on: avatarIds.includes(a.id) }"
          :aria-pressed="avatarIds.includes(a.id)"
          @click="toggle(avatarIds, a.id)"
        >
          <img v-if="a.imageUrl" :src="a.imageUrl" alt="" loading="lazy" />
          <UserRound v-else :size="13" :stroke-width="1.8" />
          <span class="mx-chip-name">{{ a.name }}</span>
        </button>
      </div>
      <p v-else class="mx-empty">{{ t('viralClone.variants.avatarsEmpty') }}</p>
    </div>

    <!-- ภาษา -->
    <div class="mx-group">
      <p class="mx-label">{{ t('viralClone.variants.languagesLabel') }}</p>
      <div class="mx-chips">
        <button
          v-for="lang in CLONE_LANGUAGES" :key="`l-${lang}`" type="button"
          class="mx-chip mx-chip-lang" :class="{ on: languages.includes(lang) }"
          :aria-pressed="languages.includes(lang)"
          @click="toggle(languages, lang)"
        >
          {{ t(`viralClone.languages.${lang}`) }}
        </button>
      </div>
    </div>

    <div class="mx-foot">
      <span class="mx-count">{{ t('viralClone.variants.countWill', { n: count }) }}</span>
      <span v-if="overCap" class="mx-overcap">{{ t('viralClone.variants.overCap', { cap: CLONE_MATRIX_CAP }) }}</span>
      <button class="btn btn-primary" type="button" :disabled="busy || overCap" @click="create">
        <Loader2 v-if="busy" :size="13" class="animate-spin" />
        {{ t('viralClone.variants.create') }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Package, UserRound } from 'lucide-vue-next'
import { CLONE_LANGUAGES, CLONE_MATRIX_CAP, matrixOverCap, matrixVariantCount, usableHooks } from '../utils/viralCloneFlow'

const props = defineProps({
  blueprint: { type: Object, default: null },
  products: { type: Array, default: () => [] },
  avatars: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['create'])
const { t } = useI18n()

// ไม่เลือกมุมไหนเลย = ใช้ค่า default ของโปรเจกต์ (backend นับเป็น 1 ทาง)
const hookIdx = ref([])
const productIds = ref([])
const avatarIds = ref([])
const languages = ref([])

const hookOptions = computed(() => usableHooks(props.blueprint))
const count = computed(() => matrixVariantCount({ hookIndexes: hookIdx.value, productIds: productIds.value, avatarIds: avatarIds.value, languages: languages.value }))
const overCap = computed(() => matrixOverCap({ hookIndexes: hookIdx.value, productIds: productIds.value, avatarIds: avatarIds.value, languages: languages.value }))

function toggle(arr, value) {
  const i = arr.indexOf(value)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(value)
}

function create() {
  if (overCap.value || props.busy) return
  emit('create', {
    hookIndexes: [...hookIdx.value],
    productIds: [...productIds.value],
    avatarIds: [...avatarIds.value],
    languages: [...languages.value],
  })
}
</script>

<style scoped>
.mx-builder { display: flex; flex-direction: column; gap: 14px; }
.mx-group { display: flex; flex-direction: column; gap: 6px; }
.mx-label { margin: 0; font-size: 12px; font-weight: 600; color: var(--text-2); }
.mx-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.mx-chip {
  display: inline-flex; align-items: center; gap: 7px;
  max-width: 260px;
  padding: 6px 12px;
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface-soft);
  font-size: 12.5px; color: var(--text-1);
  cursor: pointer;
  transition: border-color 0.15s var(--ease-out), background 0.15s var(--ease-out);
}
.mx-chip:hover { border-color: var(--border-strong); }
.mx-chip.on { border-color: var(--accent); background: var(--accent-bg); color: var(--accent-text); }
.mx-chip img { width: 22px; height: 22px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
.mx-chip > svg { flex-shrink: 0; color: var(--text-3); }
.mx-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mx-chip-sub {
  font-size: 11px; color: var(--text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mx-chip-lang { padding: 6px 14px; }
.mx-empty { margin: 0; font-size: 11.5px; color: var(--text-3); }

.mx-foot { display: flex; align-items: center; gap: 12px; margin-top: auto; }
.mx-count { font-size: 12.5px; font-weight: 600; color: var(--text-1); }
.mx-overcap { font-size: 11.5px; color: var(--danger, #e5484d); }
.mx-foot .btn { margin-left: auto; }
</style>

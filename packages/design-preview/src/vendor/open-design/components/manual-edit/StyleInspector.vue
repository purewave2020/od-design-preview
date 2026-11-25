<!-- Ported to Vue from nexu-io/open-design ManualEditPanel.tsx `StyleInspector` (Apache-2.0). -->
<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import type { ProjectDesignTokenSuggestion, ProjectDesignTokenSuggestionProp } from '../../shims/registry';
import { useT } from '../../shims/i18n';
import type { ManualEditStyles, ManualEditTarget } from '../../edit-mode/types';
import ColorRow from './ColorRow.vue';
import DropdownRow from './DropdownRow.vue';
import EditSection from './EditSection.vue';
import FontRow from './FontRow.vue';
import QuadRow from './QuadRow.vue';
import UnitRow from './UnitRow.vue';
import {
  COLOR_SUGGESTION_PROPS,
  STYLE_TO_SUGGESTION_PROP,
  SUGGESTION_TO_STYLE_KEY,
  WEIGHT_OPTS,
  borderStyleOptions,
  itemAlignOptions,
  justifyOptions,
  layoutDirectionOptions,
  sideToProp,
  textAlignOptions,
  type QuadSide,
} from './panel-model';

const props = withDefaults(
  defineProps<{
    target: ManualEditTarget;
    styles: ManualEditStyles;
    onChange: (key: keyof ManualEditStyles, value: string) => void;
    onApply: (styles: Partial<ManualEditStyles>) => void;
    tokenSuggestions?: ProjectDesignTokenSuggestion[];
    tokenSuggestionsLoading?: boolean;
    onApplyTokenSuggestion?: (prop: keyof ManualEditStyles, value: string) => void;
    onInspectValueSelect?: (prop: ProjectDesignTokenSuggestionProp, value: string) => void;
  }>(),
  { tokenSuggestions: () => [], tokenSuggestionsLoading: false, onApplyTokenSuggestion: undefined, onInspectValueSelect: undefined },
);

const t = useT();
const u = (key: keyof ManualEditStyles, value: string) => props.onChange(key, value);
const summary = computed(() => props.target.computedSummary);
const layoutDisabled = computed(() => !props.target.isLayoutContainer);
const widthPlaceholder = computed(() => (props.styles.width ? '' : `${Math.round(props.target.rect.width)}px`));
const heightPlaceholder = computed(() => (props.styles.height ? '' : `${Math.round(props.target.rect.height)}px`));
const axes = computed(() => ({
  t: t('manualEdit.sideTop'),
  r: t('manualEdit.sideRight'),
  b: t('manualEdit.sideBottom'),
  l: t('manualEdit.sideLeft'),
}));

// Which field is focused → drives the reference-values strip below the list.
const activeField = shallowRef<{ key: keyof ManualEditStyles; label: string } | null>(null);
// Reset when the selected element changes (this component persists across selections).
watch(
  () => props.target.id,
  () => {
    activeField.value = null;
  },
);

function activate(key: keyof ManualEditStyles, label: string) {
  activeField.value = { key, label };
  const prop = STYLE_TO_SUGGESTION_PROP[key];
  if (!prop || !props.onInspectValueSelect) return;
  const summaryValue = (summary.value as Partial<Record<string, string>> | undefined)?.[key];
  const current = (props.styles[key] || summaryValue || '').trim();
  if (current) props.onInspectValueSelect(prop, current);
}

const activeProp = computed(() => (activeField.value ? STYLE_TO_SUGGESTION_PROP[activeField.value.key] : undefined));
const activeSuggestions = computed(() => (activeProp.value ? props.tokenSuggestions.filter((s) => s.prop === activeProp.value) : []));
const activeIsColor = computed(() => (activeProp.value ? COLOR_SUGGESTION_PROPS.has(activeProp.value) : false));

function applyBorderWidth(v: string) {
  props.onApply({ borderTopWidth: v, borderRightWidth: v, borderBottomWidth: v, borderLeftWidth: v });
}
function quadChange(base: 'padding' | 'margin', side: QuadSide, value: string) {
  u(sideToProp(base, side), value);
}
</script>

<template>
  <div class="cc-inspector">
    <EditSection :title="t('manualEdit.parameters')">
      <ColorRow
        :label="t('manualEdit.textColor')"
        :value="styles.color"
        :placeholder="summary?.color"
        @change="u('color', $event)"
        @focus="activate('color', t('manualEdit.textColor'))"
      />
      <ColorRow
        :label="t('manualEdit.background')"
        :value="styles.backgroundColor"
        :placeholder="summary?.backgroundColor"
        @change="u('backgroundColor', $event)"
        @focus="activate('backgroundColor', t('manualEdit.background'))"
      />
      <UnitRow
        :label="t('manualEdit.opacity')"
        :value="styles.opacity"
        placeholder="1"
        unit=""
        @change="u('opacity', $event)"
        @focus="activate('opacity', t('manualEdit.opacity'))"
      />
      <FontRow
        :label="t('manualEdit.fontFamily')"
        :value="styles.fontFamily"
        :placeholder="summary?.fontFamily"
        @change="u('fontFamily', $event)"
        @focus="activate('fontFamily', t('manualEdit.fontFamily'))"
      />
      <div class="cc-pair">
        <UnitRow
          :label="t('manualEdit.fontSize')"
          :value="styles.fontSize"
          :placeholder="summary?.fontSize"
          unit="px"
          auto-unit
          @change="u('fontSize', $event)"
          @focus="activate('fontSize', t('manualEdit.fontSize'))"
        />
        <DropdownRow
          :label="t('manualEdit.weight')"
          :value="styles.fontWeight"
          :options="WEIGHT_OPTS"
          :placeholder="summary?.fontWeight"
          @change="u('fontWeight', $event)"
          @focus="activate('fontWeight', t('manualEdit.weight'))"
        />
      </div>
      <!-- Line height + tracking stay in the parameters list. -->
      <div class="cc-pair">
        <UnitRow
          :label="t('manualEdit.lineHeight')"
          :value="styles.lineHeight"
          :placeholder="summary?.lineHeight"
          unit=""
          @change="u('lineHeight', $event)"
          @focus="activate('lineHeight', t('manualEdit.lineHeight'))"
        />
        <UnitRow
          :label="t('manualEdit.letterSpacing')"
          :value="styles.letterSpacing"
          :placeholder="summary?.letterSpacing"
          unit="px"
          auto-unit
          @change="u('letterSpacing', $event)"
          @focus="activate('letterSpacing', t('manualEdit.letterSpacing'))"
        />
      </div>
      <UnitRow
        :label="t('manualEdit.radius')"
        :value="styles.borderRadius"
        :placeholder="summary?.borderRadius"
        unit="px"
        auto-unit
        @change="u('borderRadius', $event)"
        @focus="activate('borderRadius', t('manualEdit.radius'))"
      />
      <div class="cc-pair">
        <ColorRow
          :label="t('manualEdit.borderColor')"
          :value="styles.borderColor"
          :placeholder="summary?.borderColor"
          @change="u('borderColor', $event)"
          @focus="activate('borderColor', t('manualEdit.borderColor'))"
        />
        <UnitRow
          :label="t('manualEdit.borderWidth')"
          :value="styles.borderTopWidth"
          unit="px"
          auto-unit
          @change="applyBorderWidth"
          @focus="activate('borderTopWidth', t('manualEdit.borderWidth'))"
        />
      </div>
      <!-- A border width with no style is invisible on most resets. -->
      <DropdownRow :label="t('manualEdit.borderStyle')" :value="styles.borderStyle" :options="borderStyleOptions(t)" @change="u('borderStyle', $event)" />
      <div class="cc-pair">
        <UnitRow
          :label="t('manualEdit.width')"
          :value="styles.width"
          :placeholder="widthPlaceholder"
          unit="px"
          auto-unit
          @change="u('width', $event)"
          @focus="activate('width', t('manualEdit.width'))"
        />
        <UnitRow
          :label="t('manualEdit.height')"
          :value="styles.height"
          :placeholder="heightPlaceholder"
          unit="px"
          auto-unit
          @change="u('height', $event)"
          @focus="activate('height', t('manualEdit.height'))"
        />
      </div>

      <QuadRow
        :label="t('manualEdit.padding')"
        :axes="axes"
        :values="{ t: styles.paddingTop, r: styles.paddingRight, b: styles.paddingBottom, l: styles.paddingLeft }"
        @change="(side, value) => quadChange('padding', side, value)"
        @focus="activate('padding', t('manualEdit.padding'))"
      />
      <QuadRow
        :label="t('manualEdit.margin')"
        :axes="axes"
        :values="{ t: styles.marginTop, r: styles.marginRight, b: styles.marginBottom, l: styles.marginLeft }"
        @change="(side, value) => quadChange('margin', side, value)"
        @focus="activate('margin', t('manualEdit.margin'))"
      />

      <div class="cc-pair">
        <DropdownRow
          :label="t('manualEdit.layoutDirection')"
          :value="styles.flexDirection"
          :options="layoutDirectionOptions(t)"
          :disabled="layoutDisabled"
          @change="u('flexDirection', $event)"
        />
        <DropdownRow
          :label="t('manualEdit.distribution')"
          :value="styles.justifyContent"
          :options="justifyOptions(t)"
          :disabled="layoutDisabled"
          @change="u('justifyContent', $event)"
        />
      </div>
      <div class="cc-pair">
        <UnitRow
          :label="t('manualEdit.gap')"
          :value="styles.gap"
          unit="px"
          auto-unit
          :disabled="layoutDisabled"
          @change="u('gap', $event)"
          @focus="activate('gap', t('manualEdit.gap'))"
        />
        <!-- Non-flex/grid targets get a text-align dropdown instead of the flex cross-axis. -->
        <DropdownRow
          v-if="layoutDisabled"
          :label="t('manualEdit.align')"
          :value="styles.textAlign"
          :options="textAlignOptions(t)"
          @change="u('textAlign', $event)"
        />
        <DropdownRow v-else :label="t('manualEdit.align')" :value="styles.alignItems" :options="itemAlignOptions(t)" @change="u('alignItems', $event)" />
      </div>
      <p v-if="layoutDisabled" class="cc-section-hint">{{ t('manualEdit.layoutUnavailable') }}</p>
    </EditSection>

    <div v-if="activeField && activeProp" class="cc-suggest">
      <div class="cc-suggest-head">
        <span>{{ t('manualEdit.referenceValues') }}</span>
        <em>{{ activeField.label }}</em>
      </div>
      <div v-if="tokenSuggestionsLoading" class="cc-suggest-empty">{{ t('manualEdit.referenceValuesLoading') }}</div>
      <div v-else-if="activeSuggestions.length === 0" class="cc-suggest-empty">{{ t('manualEdit.referenceValuesEmpty') }}</div>
      <div v-else class="cc-suggest-list">
        <button
          v-for="(suggestion, index) in activeSuggestions"
          :key="`${suggestion.prop}-${suggestion.token}-${index}`"
          type="button"
          class="cc-suggest-chip"
          :title="`${suggestion.matchReason} · ${suggestion.sourceFile}:${suggestion.line}`"
          @click="onApplyTokenSuggestion?.(SUGGESTION_TO_STYLE_KEY[suggestion.prop], suggestion.value)"
        >
          <span v-if="activeIsColor" class="cc-suggest-swatch" :style="{ background: suggestion.value }" aria-hidden="true" />
          <span class="cc-suggest-token">{{ suggestion.token }}</span>
          <span class="cc-suggest-val">{{ suggestion.value }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

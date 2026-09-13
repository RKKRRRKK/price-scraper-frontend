<template>
  <div class="bawu-app" :class="['layout-' + layout, { 'rail-open': railOpen }]">
    <!-- ══════════ DESKTOP ══════════ -->
    <template v-if="layout === 'desktop'">
      <!-- Rail: in-flow, so opening it pushes the stage aside rather than covering it -->
      <aside class="rail-overlay" :class="{ open: railOpen }">
        <div class="rail-head">
          <div class="rail-head-text">
            <div class="eyebrow">Tools</div>
            <div class="rail-title-row"><h1 class="rail-title">Bawu</h1><span class="rail-sub">{{ store.scores.length }} {{ store.scores.length === 1 ? 'score' : 'scores' }}</span></div>
          </div>
          <button class="icon-btn rail-close" @click="railOpen = false" title="Close">
            <i class="pi pi-times" style="font-size: 0.875rem;"></i>
          </button>
        </div>

        <div class="rail-actions">
          <button class="add-btn rail-new" @click="openImport">
            <i class="pi pi-plus" style="font-size: 0.8125rem;"></i> New score
          </button>
          <div class="rail-newsheet-wrap">
            <button class="icon-btn rail-newfolder" title="New blank sheet — add notes by hand" @click="newSheetKeyMenu = !newSheetKeyMenu">
              <i class="pi pi-file-edit" style="font-size: 0.9rem;"></i>
            </button>
            <div v-if="newSheetKeyMenu" class="sq-menu-backdrop" @click="newSheetKeyMenu = false"></div>
            <div v-if="newSheetKeyMenu" class="rail-newsheet-menu">
              <div class="sq-menu-label">New sheet in…</div>
              <button
                v-for="k in KEY_CHOICES"
                :key="k"
                class="sq-menu-item"
                @click="createBlankSheet(k)"
              >1={{ KEYS[k].label }}</button>
            </div>
          </div>
          <button class="icon-btn rail-newfolder" title="New folder" @click="startAddFolder">
            <i class="pi pi-folder-plus" style="font-size: 0.9rem;"></i>
          </button>
        </div>

        <div class="rail-search">
          <i class="pi pi-search"></i>
          <input v-model="railQuery" type="text" placeholder="Filter scores…" />
          <button v-if="railQuery" class="rail-search-clear" @click="railQuery = ''" title="Clear">
            <i class="pi pi-times"></i>
          </button>
        </div>

        <div v-if="railSelectedIds.size" class="rail-selection-bar">
          <span class="rail-selection-count">{{ railSelectedIds.size }} selected</span>
          <button class="rail-selection-clear" @click="clearRailSelection">Clear</button>
          <button class="rail-selection-delete" @click="deleteRailSelected"><i class="pi pi-trash"></i> Delete</button>
        </div>

        <div class="rail-list">
          <div v-if="store.loading && !store.scores.length" class="rail-state">
            <i class="pi pi-spin pi-spinner" style="font-size: 1.25rem;"></i>
          </div>
          <div v-else-if="!store.scores.length && !store.folders.length && !addingFolder" class="rail-state">
            <i class="pi pi-headphones rail-state-icon"></i>
            <span>No scores yet — snap a photo of jianpu to start.</span>
          </div>
          <div v-else-if="railQuery && !matchedScores.length" class="rail-state">
            <i class="pi pi-search rail-state-icon"></i>
            <span>No matches for “{{ railQuery }}”.</span>
          </div>

          <template v-else>
            <div v-if="addingFolder" class="folder-add">
              <i class="pi pi-folder folder-icon"></i>
              <input
                ref="newFolderInput"
                v-model="newFolderName"
                type="text"
                placeholder="Folder name…"
                @keyup.enter="confirmAddFolder"
                @keyup.esc="cancelAddFolder"
                @blur="confirmAddFolder"
              />
            </div>

            <div v-for="f in visibleFolders" :key="f.id" class="folder">
              <div class="folder-head" @click="toggleFolder(f.id)">
                <i class="pi folder-chevron" :class="isExpanded(f.id) ? 'pi-chevron-down' : 'pi-chevron-right'"></i>
                <i class="pi pi-folder folder-icon"></i>
                <input
                  v-if="editingFolderId === f.id"
                  class="folder-rename"
                  v-model="editFolderName"
                  @click.stop
                  @keyup.enter="confirmRenameFolder(f)"
                  @keyup.esc="cancelRenameFolder"
                  @blur="confirmRenameFolder(f)"
                  :ref="focusRenameInput"
                />
                <span v-else class="folder-name">{{ f.name }}</span>
                <span class="folder-count">{{ folderScores(f.id).length }}</span>
                <span class="folder-tools" @click.stop>
                  <button class="folder-tool" title="Rename folder" @click="startRenameFolder(f)"><i class="pi pi-pencil"></i></button>
                  <button class="folder-tool" title="Delete folder" @click="removeFolder(f)"><i class="pi pi-trash"></i></button>
                </span>
              </div>
              <div v-show="isExpanded(f.id)" class="folder-body">
                <button
                  v-for="s in folderScores(f.id)"
                  :key="s.id"
                  class="rail-item"
                  :class="{ active: s.id === store.activeScoreId, 'multi-selected': railSelectedIds.has(s.id) }"
                  @click="railItemClick($event, s)"
                >
                  <span class="rail-item-icon"><i :class="s.source === 'image' ? 'pi pi-image' : 'pi pi-pencil'"></i></span>
                  <span class="rail-item-body">
                    <span class="rail-item-name">{{ s.name }}</span>
                    <span class="rail-meta">
                      <span class="stat">1={{ s.data?.key || 'F' }} · {{ noteCount(s) }} notes</span>
                      <span v-if="s.updated_at" class="stat stat-time">{{ shortAgo(s.updated_at) }}</span>
                    </span>
                  </span>
                  <span class="rail-item-kebab" role="button" title="Options" @click.stop="openRowMenu($event, s)"><i class="pi pi-ellipsis-v"></i></span>
                </button>
                <div v-if="!folderScores(f.id).length" class="folder-empty">Empty</div>
              </div>
            </div>

            <div v-if="ungroupedScores.length" class="folder-loose">
              <div v-if="visibleFolders.length" class="loose-label">No folder</div>
              <button
                v-for="s in ungroupedScores"
                :key="s.id"
                class="rail-item"
                :class="{ active: s.id === store.activeScoreId, 'multi-selected': railSelectedIds.has(s.id) }"
                @click="railItemClick($event, s)"
              >
                <span class="rail-item-icon"><i :class="s.source === 'image' ? 'pi pi-image' : 'pi pi-pencil'"></i></span>
                <span class="rail-item-body">
                  <span class="rail-item-name">{{ s.name }}</span>
                  <span class="rail-meta">
                    <span class="stat">1={{ s.data?.key || 'F' }} · {{ noteCount(s) }} notes</span>
                    <span v-if="s.updated_at" class="stat stat-time">{{ shortAgo(s.updated_at) }}</span>
                  </span>
                </span>
                <span class="rail-item-kebab" role="button" title="Options" @click.stop="openRowMenu($event, s)"><i class="pi pi-ellipsis-v"></i></span>
              </button>
            </div>
          </template>
        </div>

        <!-- Per-score options menu -->
        <div v-if="rowMenu.open" class="sq-menu-backdrop" @click="closeRowMenu" @contextmenu.prevent="closeRowMenu"></div>
        <div v-if="rowMenu.open" class="sq-menu" :style="{ top: rowMenu.y + 'px', left: rowMenu.x + 'px' }">
          <button class="sq-menu-item" @click="renameFromMenu"><i class="pi pi-pencil"></i> Rename</button>
          <div class="sq-menu-sep"></div>
          <div class="sq-menu-label">Move to folder</div>
          <button class="sq-menu-item" :class="{ on: !menuScore?.folder_id }" @click="moveTo(null)">
            <i class="pi pi-inbox"></i> No folder
          </button>
          <button
            v-for="f in store.folders"
            :key="f.id"
            class="sq-menu-item"
            :class="{ on: menuScore?.folder_id === f.id }"
            @click="moveTo(f.id)"
          >
            <i class="pi pi-folder"></i> {{ f.name }}
          </button>
          <div v-if="!store.folders.length" class="sq-menu-hint">No folders yet — use the folder button.</div>
          <div class="sq-menu-sep"></div>
          <button class="sq-menu-item danger" @click="deleteFromMenu"><i class="pi pi-trash"></i> Delete score</button>
        </div>
      </aside>

      <!-- Stage -->
      <main class="stage">
        <!-- Floating controls: expand the rail (top-left) + tuner (bottom-left) -->
        <button v-show="!railOpen" class="rail-fab rail-fab-top" @click="railOpen = true" title="Scores">
          <i class="pi pi-angle-double-right"></i>
        </button>
        <button class="rail-fab rail-fab-tuner" :class="{ on: tunerOpen }" @click="toggleTuner" title="Tuner">
          <i class="pi pi-gauge"></i>
        </button>

        <!-- Tuner popup (anchored bottom-left, over the tuner button) -->
        <BawuTuner
          :open="tunerOpen"
          :pitch="pitch"
          :mic-on="micActive"
          :target-note="score ? targetNote : null"
          @close="tunerOpen = false"
        />

        <div v-if="!score" class="empty">
          <div class="empty-art"><i class="pi pi-headphones" style="font-size: 3.5rem; color: var(--text-faint);"></i></div>
          <div class="empty-title">No score selected</div>
          <div class="empty-sub">Photograph jianpu or western notation and let the AI turn it into a practice roll — or type jianpu by hand.</div>
          <div class="empty-actions">
            <button class="add-btn add-btn-lg" @click="openImport">
              <i class="pi pi-plus" style="font-size: 0.875rem;"></i> New score
            </button>
            <button class="btn-ghost" @click="createBlankSheet">
              <i class="pi pi-file-edit" style="font-size: 0.875rem;"></i> Blank sheet
            </button>
          </div>
        </div>

        <template v-else>
          <!-- Header -->
          <div class="stage-header">
            <div class="header-title">
              <input class="score-name" v-model="nameDraft" @change="saveName" placeholder="Score name" />
              <div class="header-meta">
                <span class="hm-key">1={{ keyLabel }}</span> ·
                {{ playableNotes.length }} notes
                <template v-if="aiModelLabel"> · <span class="hm-model" :title="aiModelTitle"><i class="pi pi-sparkles"></i> {{ aiModelLabel }}</span></template>
                <span v-if="store.saving" class="hm-saving"><i class="pi pi-spin pi-spinner"></i> Saving…</span>
              </div>
            </div>

            <div class="mode-pill">
              <button class="ms" :class="{ on: !editMode && mode === 'follow' }" @click="selectMode('follow')"><i class="pi pi-user"></i> Follow me</button>
              <button class="ms" :class="{ on: !editMode && mode === 'steady' }" @click="selectMode('steady')"><i class="pi pi-stopwatch"></i> Steady</button>
              <button class="ms" :class="{ on: !editMode && mode === 'listen' }" @click="selectMode('listen')"><i class="pi pi-volume-up"></i> Listen</button>
              <span class="ms-div"></span>
              <button class="ms ms-edit" :class="{ on: editMode }" @click="toggleEdit">
                <i class="pi" :class="editMode ? 'pi-check' : 'pi-pencil'"></i> {{ editMode ? 'Done' : 'Edit' }}
              </button>
            </div>

            <div class="header-right">
              <button v-if="traceLog.length" class="btn-ghost btn-sm" @click="logOpen = !logOpen" title="What the last AI run actually sent and received">
                <i class="pi pi-server" style="font-size: 0.8rem;"></i> Stream
              </button>
              <button class="btn-ghost btn-sm" @click="exportMidi" title="Download as MIDI">
                <i class="pi pi-download" style="font-size: 0.8rem;"></i> .mid
              </button>
              <button class="btn-convert" @click="openImport" title="Convert another score">
                <i class="pi pi-sparkles" style="font-size: 0.8rem;"></i> AI convert
              </button>
              <button class="icon-btn icon-danger" @click="removeScore" :title="isDraft ? 'Discard transcription' : 'Delete score'">
                <i class="pi pi-trash" style="font-size: 0.875rem;"></i>
              </button>
            </div>
          </div>

          <!-- Streaming progress / truncation strip -->
          <div v-if="isDraft && (streaming || draft.truncated || draft.error)" class="stream-strip" :class="{ warn: draft.truncated || draft.error }">
            <template v-if="streaming">
              <i class="pi pi-spin pi-spinner"></i>
              <span class="ss-text">
                {{ streamPhase.text }}
                <b v-if="streamPhase.detail">{{ streamPhase.detail }}</b>
              </span>
              <div class="ss-bar">
                <div class="ss-fill" :class="{ indet: progressPct == null }" :style="progressPct != null ? { width: progressPct + '%' } : {}"></div>
              </div>
              <span class="ss-hint" :class="{ stalled: streamPhase.stalled }">{{ streamPhase.hint }}</span>
              <button class="btn-ghost btn-sm" @click="logOpen = !logOpen"><i class="pi pi-server" style="font-size: 0.7rem;"></i> {{ logOpen ? 'Hide' : 'Details' }}</button>
              <button class="btn-ghost btn-sm" @click="discardDraft">Cancel</button>
            </template>
            <template v-else>
              <i class="pi pi-exclamation-triangle"></i>
              <span class="ss-text">
                {{ draft.error || `Transcription may be incomplete — ${draft.data.lines.length} ${draft.data.lines.length === 1 ? 'line' : 'lines'} so far.` }}
              </span>
              <button class="btn-ghost btn-sm" @click="logOpen = !logOpen"><i class="pi pi-server" style="font-size: 0.7rem;"></i> {{ logOpen ? 'Hide' : 'What happened?' }}</button>
              <button class="btn-primary btn-sm" @click="continueDraft"><i class="pi pi-arrow-right" style="font-size: 0.75rem;"></i> Continue</button>
              <button v-if="draft.data.lines.length" class="btn-ghost btn-sm" @click="keepDraft">Keep as is</button>
              <button class="btn-ghost btn-sm" @click="discardDraft">Discard</button>
            </template>
          </div>

          <BawuStreamLog
            :open="logOpen"
            :entries="traceLog"
            :prompt="tracePrompt"
            :stats="traceStats"
            :live="streaming || lyricsRunning"
            @close="logOpen = false"
            @clear="clearTrace"
          />

          <!-- Content row: roll + docked jianpu panel -->
          <div class="player">
            <section class="desk" :class="{ editing: editMode }">
              <!-- Practice toolbar -->
              <div v-if="!editMode" class="desk-bar">
                <div class="seg" title="Note labels">
                  <button :class="{ on: notation === 'jianpu' }" @click="notation = 'jianpu'">1</button>
                  <button :class="{ on: notation === 'western' }" @click="notation = 'western'">C</button>
                </div>
                <span class="tb-div"></span>
                <div class="seg seg-zoom" :title="'Roll zoom — ' + PXV + 'px per beat'">
                  <button @click="zoomRoll(-0.25)" :disabled="rollZoom <= 0.5"><i class="pi pi-minus"></i></button>
                  <button class="zoom-val" @click="rollZoom = 1">{{ Math.round(rollZoom * 100) }}%</button>
                  <button @click="zoomRoll(0.25)" :disabled="rollZoom >= 2"><i class="pi pi-plus"></i></button>
                </div>
                <span class="tb-div"></span>
                <button
                  v-if="canLyricsPass"
                  class="chip chip-sm chip-ai"
                  @click="openLyricsPass"
                  :title="lyricsPresent ? 'Read the lyrics off the picture again' : 'Read the sung words off the original picture'"
                ><i class="pi pi-sparkles" style="font-size: 0.75rem;"></i> {{ lyricsPresent ? 'Redo lyrics' : 'Get lyrics' }}</button>
                <button
                  v-if="lyricsPresent"
                  class="chip chip-sm"
                  :class="{ live: lyricsOn }"
                  @click="lyricsOn = !lyricsOn"
                  title="Show lyric syllables"
                ><i class="pi pi-comment" style="font-size: 0.75rem;"></i> Lyrics</button>
                <template v-if="lyricsPresent && lyricsOn">
                  <div class="seg" title="Lyric script">
                    <button :class="{ on: lyricsScript === 'chinese' }" @click="lyricsScript = 'chinese'">中文</button>
                    <button :class="{ on: lyricsScript === 'pinyin' }" @click="lyricsScript = 'pinyin'">Pīnyīn</button>
                  </div>
                  <div class="seg" title="Where the syllables show">
                    <button :class="{ on: lyricsPosition === 'band' }" @click="lyricsPosition = 'band'">Lyric line</button>
                    <button :class="{ on: lyricsPosition === 'notes' }" @click="lyricsPosition = 'notes'">On notes</button>
                  </div>
                </template>
                <div class="spacer"></div>
                <span class="mode-hint">{{ modeHint }}</span>
              </div>

              <!-- Edit toolbar (red) -->
              <div v-else class="edit-bar">
                <button class="eb-icon" :disabled="!undoStack.length" @click="undo" title="Undo (⌘Z)"><i class="pi pi-undo" style="font-size: 0.75rem;"></i></button>
                <span class="eb-div"></span>
                <button class="eb-btn" @click="copySelection" :disabled="!selCount"><i class="pi pi-clone" style="font-size: 0.7rem;"></i> Copy <b class="kbd">⌘C</b></button>
                <button class="eb-btn" @click="pasteSelection" :disabled="!clipboard"><i class="pi pi-file-import" style="font-size: 0.7rem;"></i> Paste <b class="kbd">⌘V</b></button>
                <button v-if="selCount" class="eb-selchip" @click="clearSelection">{{ selCount }} selected <i class="pi pi-times" style="font-size: 0.6rem;"></i></button>
                <span class="eb-div"></span>
                <button
                  class="eb-icon"
                  :class="{ on: auditionOn }"
                  @click="auditionOn = !auditionOn"
                  :title="auditionOn ? 'Notes sound as you click and drag them — click to mute' : 'Editing is silent — click to hear notes as you place them'"
                ><i :class="auditionOn ? 'pi pi-volume-up' : 'pi pi-volume-off'" style="font-size: 0.75rem;"></i></button>
                <span class="eb-div"></span>
                <div class="seg seg-zoom" :title="'Roll zoom — ' + PXV + 'px per beat'">
                  <button @click="zoomRoll(-0.25)" :disabled="rollZoom <= 0.5"><i class="pi pi-minus"></i></button>
                  <button class="zoom-val" @click="rollZoom = 1">{{ Math.round(rollZoom * 100) }}%</button>
                  <button @click="zoomRoll(0.25)" :disabled="rollZoom >= 2"><i class="pi pi-plus"></i></button>
                </div>
                <span class="eb-div"></span>
                <div class="seg seg-zoom" title="Score tempo — saved with the sheet">
                  <button @click="setScoreBpm(scoreBpm - 5)" :disabled="scoreBpm <= 20"><i class="pi pi-minus"></i></button>
                  <button class="zoom-val" tabindex="-1">{{ scoreBpm }} BPM</button>
                  <button @click="setScoreBpm(scoreBpm + 5)" :disabled="scoreBpm >= 300"><i class="pi pi-plus"></i></button>
                </div>
                <div class="spacer"></div>
                <span class="eb-hint"><b class="kbd">right-click</b> to add · <b class="kbd">drag</b> to select · <b class="kbd">1–7</b> insert · <b class="kbd">↑↓</b> pitch · <b class="kbd">←→</b> length · <b class="kbd">Del</b></span>
              </div>

              <!-- Deck: the instrument across the top, notes rising into it -->
              <BawuFluteRoll
                ref="fluteRoll"
                :data="activeData"
                :notes="laneNotes"
                :total-beats="totalBeats"
                :beats-per-bar="beatsPerBar"
                :px="PXV"
                :grid="GRID"
                :key-name="keyName"
                :notation="notation"
                :current-idx="uiIdx"
                :edit-mode="editMode"
                :selected="selectedIds"
                :lyrics-on="lyricsOn && lyricsPosition === 'notes' && lyricsPresent"
                :lyrics-script="lyricsScript"
                :playing="playing"
                :mic-active="micActive"
                :heard-midi="pitch ? pitch.midiFloat : null"
                :tip="tipText"
                :trace-samples="traceSamples"
                :bpm="bpm"
                :can-paste="!!clipboard"
                @seek="jumpTo"
                @seek-beat="onRollSeekBeat"
                @update:selected="selectedIds = $event"
                @preview="liveEdit = $event"
                @commit="onRollCommit"
                @audition="onRollAudition"
                @hold="onRollHold"
                @paste="pasteAt"
              />
              <!-- Karaoke band -->
              <div v-if="showBand" class="band">
                <span class="band-label">Lyrics</span>
                <div class="band-window">
                  <span
                    v-for="k in karaoke"
                    :key="k.i"
                    class="band-syl"
                    :class="{ cur: k.cur }"
                    :style="{ opacity: k.cur ? 1 : Math.max(0.35, 1 - k.dist * 0.18) }"
                  >
                    <span class="bs-main">{{ k.t }}</span>
                    <span v-if="k.sub" class="bs-sub">{{ k.sub }}</span>
                  </span>
                </div>
                <span class="band-loc">{{ locLabel }}</span>
              </div>

              <!-- Inspector (edit) -->
              <div v-if="editMode" class="inspector">
                <span class="insp-sel">{{ selLabel }}</span>
                <span class="insp-div"></span>
                <span class="insp-lbl">Degree</span>
                <div class="seg seg-deg">
                  <button v-for="d in 7" :key="'deg' + d" :class="{ on: selDeg === d }" :disabled="!selCount" @click="setSelDegree(d)">{{ d }}</button>
                </div>
                <span class="insp-lbl">Pitch</span>
                <span class="row-step">
                  <button :disabled="!selCount" @click="shiftSelRow(1)" title="Lower"><i class="pi pi-angle-down"></i></button>
                  <span class="row-val">{{ selRowLabel }}</span>
                  <button :disabled="!selCount" @click="shiftSelRow(-1)" title="Higher"><i class="pi pi-angle-up"></i></button>
                </span>
                <span class="insp-lbl">Length</span>
                <div class="seg seg-len">
                  <button v-for="[lab, val] in LEN_PRESETS" :key="lab" :class="{ on: selLenActive === val }" :disabled="!selCount" @click="setSelLength(val)">{{ lab }}</button>
                </div>
                <span class="insp-lbl">Lyric</span>
                <input class="insp-ly" :value="selSyl" :disabled="selCount !== 1" @change="setSelLyric($event.target.value)" placeholder="—" />
                <div class="spacer"></div>
                <button class="insp-del" :disabled="!selCount" @click="deleteSelection"><i class="pi pi-trash" style="font-size: 0.7rem;"></i> Delete</button>
              </div>

              <!-- Inspector · expression -->
              <div v-if="editMode" class="inspector insp-fx">
                <span class="insp-lbl">Join</span>
                <button
                  class="fx-btn"
                  :class="{ on: selFx.ti }"
                  :disabled="!canTie"
                  :title="canTie ? 'Tie into the next note — one sustained sound' : 'A tie needs the next note to be the same pitch and touching this one'"
                  @click="toggleSelTie"
                >⌣ Tie</button>
                <button
                  class="fx-btn"
                  :class="{ on: selFx.sl }"
                  :disabled="!selCount"
                  title="Slur into the next note — legato, no re-tonguing"
                  @click="toggleSelSlur"
                >⌢ Slur</button>
                <span class="insp-div"></span>
                <span class="insp-lbl">Slide</span>
                <button class="fx-btn" :class="{ on: selFx.gi }" :disabled="!selCount" title="Slide into the note (上/下滑音)" @click="toggleSelGlissIn">⟋ in</button>
                <button class="fx-btn" :class="{ on: selFx.go === 'off' }" :disabled="!selCount" title="Fall away at the end of the note" @click="setSelGlideOut('off')">⟍ off</button>
                <button class="fx-btn" :class="{ on: selFx.go === 'to' }" :disabled="!selCount" title="Glissando across to the next note" @click="setSelGlideOut('to')">→ next</button>
                <span class="insp-div"></span>
                <span class="insp-lbl">Bend</span>
                <span class="row-step">
                  <button :disabled="!selCount" @click="stepSelBend(-0.5)" title="Bend further down"><i class="pi pi-angle-down"></i></button>
                  <span class="row-val">{{ selFx.bd ? (selFx.bd > 0 ? '+' : '') + selFx.bd : '—' }}</span>
                  <button :disabled="!selCount" @click="stepSelBend(0.5)" title="Bend further up"><i class="pi pi-angle-up"></i></button>
                </span>
                <span class="insp-lbl">Vibrato</span>
                <div class="seg seg-vb">
                  <button v-for="v in vibChoices" :key="'vb' + v.n" :class="{ on: selFx.vb === v.n }" :disabled="!selCount" :title="v.title" @click="setSelVibrato(v.n)">{{ v.lab }}</button>
                </div>
                <div class="spacer"></div>
                <button class="fx-btn" :disabled="!selCount || !selHasFx" title="Strip every expression mark from the selection" @click="clearSelFx">
                  <i class="pi pi-eraser" style="font-size: 0.7rem;"></i> Clear
                </button>
              </div>
            </section>

            <!-- Drag divider: resize roll ↔ score panel -->
            <div v-if="wideDesk" class="col-divider" @pointerdown="onColResizeDown" title="Drag to resize"><span class="cd-grip"></span></div>

            <!-- Docked jianpu panel -->
            <aside class="score-col" :style="colStyle">
              <div class="score-col-head">
                <span class="insp-label">{{ showJianpu ? 'Transcribed jianpu' : 'Original score' }}</span>
                <div v-if="hasPicture" class="view-toggle">
                  <button :class="{ on: !showJianpu }" @click="scoreView = 'picture'" title="Original picture"><i class="pi pi-image"></i></button>
                  <button :class="{ on: showJianpu }" @click="scoreView = 'jianpu'" title="Transcribed jianpu"><i class="pi pi-list"></i></button>
                </div>
                <span class="loc">{{ locLabel }}</span>
              </div>

              <div class="page">
                <!-- Original picture with a where-are-we band + zoom -->
                <div v-if="!showJianpu" class="page-img-wrap" ref="pageImgWrap">
                  <div v-if="!imageUrl" class="page-loading"><i class="pi pi-spin pi-spinner"></i></div>
                  <template v-else>
                    <div class="page-img-scaler" :style="{ transform: 'scale(' + picZoom + ')' }">
                      <img :src="imageUrl" alt="Original score" class="page-img" />
                      <div v-if="lineCount" class="line-band" :style="lineBandStyle"></div>
                    </div>
                    <div class="zoom-pill">
                      <button @click="zoomBy(-0.25)" title="Zoom out"><i class="pi pi-minus"></i></button>
                      <button class="zoom-pct" @click="picZoom = 1" title="Reset zoom">{{ Math.round(picZoom * 100) }}%</button>
                      <button @click="zoomBy(0.25)" title="Zoom in"><i class="pi pi-plus"></i></button>
                    </div>
                  </template>
                </div>

                <!-- Transcribed jianpu sheet -->
                <div v-else class="page-jianpu">
                  <div class="a4-title">{{ score.name }}</div>
                  <div class="a4-sub">
                    Jianpu · 1={{ keyLabel }} · {{ activeData?.timeSig || '4/4' }}<template v-if="variant === 'adjusted'"> · adjusted</template>
                    <template v-if="aiModelLabel"> · via {{ aiModelLabel }}</template>
                  </div>
                  <div v-if="!jianpuLines.length" class="a4-empty">Transcribing…</div>
                  <BawuJianpuStaff
                    :lines="jianpuLines"
                    :current="currentNote"
                    :lyrics-on="lyricsPresent && lyricsOn"
                    :script="lyricsScript"
                  />
                </div>
              </div>

              <div class="key-card">
                <div class="key-card-head">
                  <div class="insp-label">Key &amp; transpose</div>
                  <div v-if="!isDraft && laneNotes.length" class="key-card-tools">
                    <button v-if="canLyricsPass" class="mini-btn" @click="openLyricsPass" title="Read the sung words off the original picture">
                      <i class="pi pi-sparkles"></i> Lyrics
                    </button>
                    <button class="mini-btn" @click="copyJianpu" title="Copy this transposition's jianpu to the clipboard">
                      <i class="pi pi-copy"></i> Copy
                    </button>
                    <button class="mini-btn" @click="openEditor" title="Copy, hand-edit and save an adjusted version">
                      <i class="pi pi-sliders-h"></i> Adjust
                    </button>
                  </div>
                </div>
                <div class="keys">
                  <button
                    v-for="k in KEY_CHOICES"
                    :key="k"
                    :class="{ active: variant === 'original' && keyName === k, 'is-orig': k === origKey }"
                    :title="k === origKey ? 'The key this score was imported in' : null"
                    @click="setKey(k)"
                  >{{ KEYS[k].label }}<span v-if="k === origKey" class="orig-tag">orig</span></button>
                  <button
                    v-if="extraOrigKey"
                    class="key-orig is-orig"
                    :class="{ active: variant === 'original' && keyName === extraOrigKey }"
                    title="The key this score was imported in"
                    @click="setKey(extraOrigKey)"
                  >{{ KEYS[extraOrigKey]?.label || extraOrigKey }}<span class="orig-tag">orig</span></button>
                  <button
                    v-if="adjusted"
                    class="key-adj"
                    :class="{ active: variant === 'adjusted' }"
                    @click="selectAdjusted"
                    title="Your hand-adjusted version"
                  >{{ KEYS[adjusted.key]?.label || adjusted.key }} · adj</button>
                  <div class="spacer"></div>
                  <button v-if="!isDraft && laneNotes.length" class="shift-btn" :disabled="savingAdjust" @click="transpose(-1)" title="All notes a semitone down">
                    <i class="pi pi-angle-down"></i> ½
                  </button>
                  <button v-if="!isDraft && laneNotes.length" class="shift-btn" :disabled="savingAdjust" @click="transpose(1)" title="All notes a semitone up">
                    <i class="pi pi-angle-up"></i> ½
                  </button>
                </div>
                <div class="key-hint">
                  Playable <b>C4–D5</b> (no natural B) ·
                  <span :class="fit.fits ? 'fit-ok' : 'fit-bad'">
                    {{ fit.fits ? 'fits ✓' : fit.missing + ' of ' + fit.total + ' notes out of range' }}
                  </span>
                </div>
              </div>
            </aside>
          </div>

          <!-- Dock (floating transport pill) -->
          <div class="dock-row">
            <div class="dock" :class="{ compact: dockCompact }">
              <button class="dk-nav" @click="goToStart" title="Back to start (Home)"><i class="pi pi-step-backward"></i></button>
              <button class="dk-nav" @click="stepBy(-1)" title="Previous note (←)"><i class="pi pi-chevron-left"></i></button>
              <button class="dk-play" :class="{ playing }" @click="togglePlay" :title="playing ? 'Pause' : 'Play (Space)'">
                <i :class="playing ? 'pi pi-pause' : 'pi pi-play'"></i>
              </button>
              <button class="dk-nav" @click="stepBy(1)" title="Next note (→)"><i class="pi pi-chevron-right"></i></button>
              <button class="dk-nav" @click="stopAll" title="Stop · back to start (Esc)"><i class="pi pi-stop"></i></button>
              <span class="dk-div"></span>
              <span class="dk-pos">{{ posLabel }}</span>
              <input
                class="slider seek"
                type="range"
                min="0"
                :max="Math.max(0, playableNotes.length - 1)"
                :value="uiIdx"
                @input="onSeek($event.target.value)"
              />
              <span class="dk-div"></span>
              <span class="dk-bpm"><b>{{ bpm }}</b><span class="dk-unit">BPM</span></span>
              <input class="slider" type="range" min="40" max="160" v-model.number="bpm" :style="{ width: dockCompact ? '3.5rem' : '5rem' }" />
              <span class="dk-div"></span>
              <select class="dk-voice" v-model="sound" title="Synth voice">
                <option value="real">Bawu</option>
                <option value="legacy">Bawu (old)</option>
                <option value="classic">Synth</option>
                <option value="mute">Muted</option>
              </select>
              <button class="dk-chip" :class="{ on: metroOn }" @click="toggleMetro" title="Metronome">
                <svg width="12" height="12" viewBox="0 0 12 12" class="metro-svg"><path d="M4.2 1.5 L7.8 1.5 L10 10.5 L2 10.5 Z" /><line x1="6" y1="8.6" x2="8.8" y2="2.6" /></svg>
                <span v-if="!dockCompact" class="dk-chip-lab">Metronome</span>
              </button>
              <button class="dk-chip" :class="{ on: reverbOn }" @click="reverbOn = !reverbOn" title="Room reverb">
                <i class="pi pi-wifi" style="font-size: 0.7rem; transform: rotate(90deg);"></i>
                <span v-if="!dockCompact" class="dk-chip-lab">Reverb</span>
              </button>
              <template v-if="reverbOn">
                <input class="slider" type="range" min="0" max="100" v-model.number="reverbLevel" title="Reverb amount" :style="{ width: dockCompact ? '3rem' : '4rem' }" />
                <span v-if="!dockCompact" class="dk-pct">{{ reverbLevel }}%</span>
              </template>
              <button class="dk-chip" :class="{ live: micOn }" @click="toggleMic" title="Mic detect">
                <i class="pi pi-microphone" style="font-size: 0.7rem;"></i>
                <span v-if="!dockCompact" class="dk-chip-lab">Mic</span>
              </button>
              <button class="dk-rec" :class="{ hot: recording }" @click="toggleRecord" :title="recording ? 'Stop take' : 'Record a take (mic)'">
                <span class="dot"></span>
              </button>
              <div class="takes" :class="{ open: takesOpen }">
                <button class="dk-takes" @click.stop="takesOpen = !takesOpen">
                  Takes <span class="take-count">{{ takes.length }}</span>
                </button>
                <div class="takes-panel" @click.stop>
                  <div class="ph"><span>Session takes</span></div>
                  <div class="pn">Recorded from your mic. Session only — download to keep; nothing is saved to Supabase.</div>
                  <div v-if="!takes.length" class="takes-empty">No takes yet — hit the red button.</div>
                  <div v-for="tk in takes" :key="tk.id" class="take-row">
                    <i class="pi pi-wave-pulse" style="font-size: 0.75rem; color: var(--text-faint);"></i>
                    <span class="tn">{{ tk.name }}</span>
                    <span class="td">{{ tk.secs }}s</span>
                    <a class="take-btn" :href="tk.url" :download="tk.name + '.' + tk.ext" title="Download"><i class="pi pi-download"></i></a>
                    <button class="take-btn danger" title="Discard" @click="discardTake(tk.id)"><i class="pi pi-times"></i></button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <p v-if="store.error" class="action-error">{{ store.error }}</p>
        <div class="toast" :class="{ show: toastMsg }">{{ toastMsg }}</div>
      </main>
    </template>
    <!-- ══════════ PHONE · PORTRAIT (jianpu reader) ══════════ -->
    <template v-else-if="layout === 'phone-portrait'">
      <div class="pp">
        <div class="pp-top">
          <button class="pp-btn" @click="railOpen = true" title="Scores"><i class="pi pi-bars"></i></button>
          <div class="pp-title" v-if="score">
            <div class="pp-name">{{ score.name }}</div>
            <div class="pp-meta"><b>1={{ keyLabel }}</b> · {{ activeData?.timeSig || '4/4' }} · {{ playableNotes.length }} notes</div>
          </div>
          <div class="pp-title" v-else><div class="pp-name">No score</div></div>
          <div v-if="lyricsPresent" class="seg">
            <button :class="{ on: lyricsScript === 'chinese' }" @click="lyricsScript = 'chinese'">中文</button>
            <button :class="{ on: lyricsScript === 'pinyin' }" @click="lyricsScript = 'pinyin'">Pīnyīn</button>
          </div>
        </div>

        <div v-if="score" class="pp-sheet" ref="ppSheetEl" :class="{ pinyin: lyricsScript === 'pinyin' }">
          <div class="a4-title">{{ score.name }}</div>
          <div class="a4-sub">Jianpu · 1={{ keyLabel }} · {{ activeData?.timeSig || '4/4' }}</div>
          <BawuJianpuStaff
            :lines="jianpuLines"
            :current="currentNote"
            :lyrics-on="true"
            :script="lyricsScript"
            variant="phone"
          />
        </div>
        <div v-else class="pp-empty">Pick a score from the drawer.</div>

        <div class="pp-hint"><i class="pi pi-mobile"></i> Rotate to landscape to practise on the roll</div>

        <!-- Transport -->
        <div v-if="score" class="pp-dock">
          <div class="ppd-row">
            <button class="ppd-nav" @click="goToStart" title="Back to start"><i class="pi pi-step-backward"></i></button>
            <button class="ppd-nav" @click="stepBy(-1)" title="Previous note"><i class="pi pi-chevron-left"></i></button>
            <button class="ppd-play" :class="{ playing }" @click="togglePlay" :title="playing ? 'Pause' : 'Play'">
              <i :class="playing ? 'pi pi-pause' : 'pi pi-play'"></i>
            </button>
            <button class="ppd-nav" @click="stepBy(1)" title="Next note"><i class="pi pi-chevron-right"></i></button>
            <span class="ppd-pos">{{ posLabel }}</span>
            <button class="ppd-icon" :class="{ on: metroOn }" @click="toggleMetro" title="Metronome">
              <svg width="14" height="14" viewBox="0 0 12 12" class="metro-svg"><path d="M4.2 1.5 L7.8 1.5 L10 10.5 L2 10.5 Z" /><line x1="6" y1="8.6" x2="8.8" y2="2.6" /></svg>
            </button>
          </div>
          <div class="ppd-row ppd-row-bpm">
            <span class="ppd-bpm"><b>{{ bpm }}</b> BPM</span>
            <input class="slider" type="range" min="40" max="160" v-model.number="bpm" />
            <input
              class="slider seek"
              type="range"
              min="0"
              :max="Math.max(0, playableNotes.length - 1)"
              :value="uiIdx"
              @input="onSeek($event.target.value)"
            />
          </div>
        </div>

        <!-- Scores drawer -->
        <div v-if="railOpen" class="drawer-scrim" @click="railOpen = false"></div>
        <div class="drawer" :class="{ open: railOpen }">
          <div class="drawer-head"><b>Scores</b><button @click="railOpen = false"><i class="pi pi-times"></i></button></div>
          <button class="add-btn drawer-new" @click="railOpen = false; openImport()"><i class="pi pi-plus"></i> New score</button>
          <div class="drawer-list">
            <button v-for="s in store.scores" :key="s.id" class="drawer-item" :class="{ active: s.id === store.activeScoreId }" @click="selectScore(s.id)">
              <span class="di-name">{{ s.name }}</span>
              <span class="di-meta">1={{ s.data?.key || 'F' }} · {{ noteCount(s) }}</span>
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- ══════════ PHONE · LANDSCAPE (roll only) ══════════ -->
    <template v-else>
      <!-- Scores drawer: in flow, so it pushes the roll across instead of covering it -->
      <div class="drawer" :class="{ open: railOpen }" @click.stop>
        <div class="drawer-head"><b>Scores</b><button @click="railOpen = false"><i class="pi pi-times"></i></button></div>
        <div class="drawer-list">
          <button v-for="s in store.scores" :key="s.id" class="drawer-item" :class="{ active: s.id === store.activeScoreId }" @click="selectScore(s.id)">
            <span class="di-name">{{ s.name }}</span>
            <span class="di-meta">1={{ s.data?.key || 'F' }} · {{ noteCount(s) }}</span>
          </button>
        </div>
      </div>

      <div class="pl" @click="chromeOn = !chromeOn">
        <div class="pl-stage">
          <div class="pl-axis">
            <div
              v-for="(n, i) in BAWU_NOTES"
              :key="n.midi"
              class="pl-axis-row"
              :class="{ active: currentNote && currentNote.row === i }"
            ><b>{{ axisBig(n) }}</b></div>
          </div>
          <div class="pl-roll" ref="rollElPhone">
            <div class="row-bg">
              <i v-for="(n, i) in BAWU_NOTES" :key="n.midi" :class="{ active: currentNote && currentNote.row === i }"></i>
            </div>
            <div class="lane" ref="laneElPhone" :style="{ width: laneWidth + 'px' }">
              <div
                v-for="b in barCount"
                :key="'plbar' + b"
                class="barline"
                :style="{ left: (b - 1) * beatsPerBar * PX + 'px' }"
              ></div>
              <svg v-if="rollHPhone" class="lane-fx" :width="laneWidth" :height="rollHPhone">
                <path v-for="(p, i) in fxPathsPhone" :key="i" :d="p.d" :class="p.cls" />
              </svg>
              <div
                v-for="n in laneNotes"
                :key="n.idx"
                class="note phone"
                :class="noteClass(n)"
                :style="noteStyle(n)"
              ><span class="note-lab">{{ noteLabel(n) }}</span></div>
            </div>
            <div class="now-group" ref="nowElPhone"><div class="nowline phone"></div></div>
          </div>
        </div>

        <!-- Always-on karaoke band -->
        <div class="pl-band">
          <span class="band-label">Lyrics</span>
          <div class="band-window">
            <span v-for="k in karaoke" :key="k.i" class="band-syl" :class="{ cur: k.cur }" :style="{ opacity: k.cur ? 1 : Math.max(0.35, 1 - k.dist * 0.2) }">
              <span class="bs-main">{{ k.t }}</span>
            </span>
          </div>
          <span class="band-loc">{{ locLabel }}</span>
        </div>

        <!-- Chrome (tap to toggle) -->
        <template v-if="chromeOn">
          <div class="pl-top" @click.stop>
            <button class="pl-pill dark" @click="exitFullscreen"><i class="pi pi-arrow-left"></i> Exit</button>
            <span class="pl-pill dark pl-name" v-if="score">{{ score.name }} · <span style="color: var(--accent-400);">1={{ keyLabel }}</span></span>
            <div class="spacer"></div>
            <button class="pl-pill light" @click="railOpen = true"><i class="pi pi-folder"></i> Scores</button>
            <button class="pl-pill red" @click="openImport"><i class="pi pi-sparkles"></i> AI</button>
          </div>
          <div class="pl-dock" @click.stop>
            <button class="pld-nav" @click="stepBy(-1)"><i class="pi pi-chevron-left"></i></button>
            <button class="pld-play" @click="togglePlay"><i :class="playing ? 'pi pi-pause' : 'pi pi-play'"></i></button>
            <button class="pld-nav" @click="stepBy(1)"><i class="pi pi-chevron-right"></i></button>
            <span class="pld-div"></span>
            <span class="pld-pos">{{ posLabel }}</span>
            <span class="pld-div"></span>
            <span class="pld-bpm"><b>{{ bpm }}</b>BPM</span>
            <input class="slider" type="range" min="40" max="160" v-model.number="bpm" style="width: 4rem;" />
            <span class="pld-div"></span>
            <button class="pld-icon" :class="{ on: metroOn }" @click="toggleMetro" title="Metronome">
              <svg width="13" height="13" viewBox="0 0 12 12" class="metro-svg"><path d="M4.2 1.5 L7.8 1.5 L10 10.5 L2 10.5 Z" /><line x1="6" y1="8.6" x2="8.8" y2="2.6" /></svg>
            </button>
            <button class="pld-icon" :class="{ on: reverbOn }" @click="reverbOn = !reverbOn" title="Reverb"><i class="pi pi-wifi" style="transform: rotate(90deg);"></i></button>
            <button class="pld-icon" :class="{ on: micOn }" @click="toggleMic" title="Mic detect"><i class="pi pi-microphone"></i></button>
          </div>
        </template>
      </div>
    </template>

    <!-- Modals (all layouts) -->
    <BawuImportModal
      :open="importOpen"
      :folders="store.folders"
      :creating="importCreating"
      :create-error="importError"
      @close="importOpen = false"
      @create="createFromImport"
      @stream="startStream"
    />

    <BawuJianpuEditor
      :open="editorOpen"
      :data="activeData"
      :saving="savingAdjust"
      @close="editorOpen = false"
      @save="saveAdjusted"
    />

    <BawuLyricsModal
      :open="lyricsOpen"
      :data="activeData"
      :score-name="score?.name || ''"
      :applying="lyricsApplying"
      :resolve-image="resolveScoreImage"
      @close="lyricsOpen = false"
      @apply="applyLyrics"
      @trace="pushTrace"
      @running="onLyricsRunning"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import { useBawuStore } from '@/stores/bawu'
import BawuTuner from '@/components/bawu/BawuTuner.vue'
import BawuImportModal from '@/components/bawu/BawuImportModal.vue'
import BawuJianpuEditor from '@/components/bawu/BawuJianpuEditor.vue'
import BawuJianpuStaff from '@/components/bawu/BawuJianpuStaff.vue'
import BawuFluteRoll from '@/components/bawu/BawuFluteRoll.vue'
import BawuLyricsModal from '@/components/bawu/BawuLyricsModal.vue'
import BawuStreamLog from '@/components/bawu/BawuStreamLog.vue'
import {
  BAWU_NOTES, KEYS, KEY_CHOICES, canonicalKey, flattenScore, fitInfo, jianpuText,
  coachDelta, coveredLabel, rowOfMidi, transposeData, midiOf, degOctAccOfMidi,
  mergeLyrics, MAX_BEND, MAX_VIBRATO,
} from '@/lib/bawu/notes'
import { urlToDataUri } from '@/lib/bawu/image'
import { dataToEvents, eventsToData, rankOfEvent, snapBeat, MIN_BEATS } from '@/lib/bawu/edit'
import {
  ensureAudio, playBawuTone, playClick, PitchTracker, TakeRecorder, takeExtension,
  setBawuVoice, setReverbEnabled, setReverbLevel,
} from '@/lib/bawu/audio'
import { downloadMidi, convertImageStream, continueTranscription, scoreToJianpuText, MODELS, EFFORTS } from '@/lib/bawu/ai'

const router = useRouter()
const store = useBawuStore()

// ── Layout constants ────────────────────────────────────────────────────────
// Roll scale. `PX` (px per beat, and so the scroll speed: PX × bpm/60 px/s) is
// computed further down from the shortest note in the piece — see `PX`.
const PX_MIN = 90 // the historical fixed scale; scores of quarters and longer keep it
const PX_MAX = 300
const MIN_NOTE_PX = 40 // the shortest note's pill must be at least this wide to read
const NOTE_GAP = 8 // px trimmed off a pill so neighbours don't touch
const PLAYHEAD_X_PHONE = 90 // px from the phone-landscape roll's left edge
// The desktop roll stands on its end, and a window is far shorter than it is
// wide — so the vertical scale is its own, much tighter, pair of bounds. A bar
// of quarters is about a hand's width of screen instead of half a metre.
const PXV_MIN = 34
const PXV_MAX = 120
const MIN_NOTE_PXV = 26 // the shortest note's block must be at least this tall

// ── Viewport / layout ───────────────────────────────────────────────────────
// documentElement.clientWidth/Height — not window.innerWidth/Height — because on
// mobile the inner* pair tracks the *visual* viewport: pinch-zooming out (or a
// "desktop site" toggle) inflates them and the app would pick the desktop layout
// while CSS still lays out against a phone-sized viewport.
function viewportW() {
  return document.documentElement?.clientWidth || window.innerWidth || 1600
}
function viewportH() {
  return document.documentElement?.clientHeight || window.innerHeight || 900
}
const vw = ref(typeof window !== 'undefined' ? viewportW() : 1600)
const vh = ref(typeof window !== 'undefined' ? viewportH() : 900)
const coarsePointer = ref(
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false,
)
const layout = computed(() => {
  // Landscape is decided by height: a phone on its side is short no matter how
  // many CSS pixels wide it claims to be.
  if (vw.value > vh.value) {
    return vh.value < 560 || (coarsePointer.value && vh.value < 720) ? 'phone-landscape' : 'desktop'
  }
  return vw.value < 900 ? 'phone-portrait' : 'desktop'
})
const dockCompact = computed(() => vw.value < 1350)
const chromeOn = ref(true) // phone-landscape chrome visibility

// ── Rail state ──────────────────────────────────────────────────────────────
const railOpen = ref(false)
const railQuery = ref('')
const expanded = ref(new Set())
const addingFolder = ref(false)
const newFolderName = ref('')
const newFolderInput = ref(null)
const editingFolderId = ref(null)
const editFolderName = ref('')
const rowMenu = ref({ open: false, x: 0, y: 0, scoreId: null })
const railSelectedIds = ref(new Set())
const railLastClickedId = ref(null)
const newSheetKeyMenu = ref(false)

// ── Player state ────────────────────────────────────────────────────────────
const mode = ref('listen')
const playing = ref(false)
const bpm = ref(80)
const metroOn = ref(true)
const micOn = ref(false)
const tunerOpen = ref(false)
// Which synth voice plays: 'real' (the modeled bawu) | 'legacy' (the previous
// modeled bawu, kept for A/B) | 'classic' (sawtooth) | 'mute'.
const sound = ref('real')
const reverbOn = ref(false)
const MAX_WET = 2.5 // slider 100% → this much wet gain
const reverbLevel = ref(Math.min(100, Math.max(0, Number(localStorage.getItem('bawu.reverb')) || 50))) // %
watch(sound, (v) => setBawuVoice(v), { immediate: true })
watch(reverbOn, (v) => setReverbEnabled(v))
watch(reverbLevel, (v) => {
  localStorage.setItem('bawu.reverb', String(v))
  setReverbLevel((v / 100) * MAX_WET)
}, { immediate: true })
const scoreView = ref('picture') // 'picture' | 'jianpu' — score-panel view toggle
const notation = ref('jianpu') // 'jianpu' | 'western' — how roll notes are labelled
const lyricsOn = ref(false) // show lyric syllables (band or on-notes)
const lyricsScript = ref(localStorage.getItem('bawu.lyricsScript') === 'pinyin' ? 'pinyin' : 'chinese')
const lyricsPosition = ref(localStorage.getItem('bawu.lyricsPosition') === 'notes' ? 'notes' : 'band')
watch(lyricsScript, (v) => localStorage.setItem('bawu.lyricsScript', v))
watch(lyricsPosition, (v) => localStorage.setItem('bawu.lyricsPosition', v))
const picZoom = ref(1) // original-picture zoom (0.5–3)
// Roll zoom (0.5–2) on top of the auto-fitted beat width — sticky across sessions.
const rollZoom = ref(Math.min(2, Math.max(0.5, Number(localStorage.getItem('bawu.rollZoom')) || 1)))
watch(rollZoom, (v) => localStorage.setItem('bawu.rollZoom', String(v)))
// How the phone-landscape roll moves while playing (the desktop deck always
// scrolls, so this no longer has a toggle of its own):
//   'roll' — the sheet scrolls leftwards past a NOW line pinned at the left
//   'line' — the sheet holds still and the line sweeps across it, turning the
//            page when it reaches the right edge (easier to read ahead from)
const scrollStyle = ref(localStorage.getItem('bawu.scrollStyle') === 'line' ? 'line' : 'roll')
// Hear notes as they're clicked, dropped and dragged, the way a piano roll does.
const auditionOn = ref(localStorage.getItem('bawu.audition') !== '0')
watch(auditionOn, (v) => localStorage.setItem('bawu.audition', v ? '1' : '0'))
const editMode = ref(false) // direct note editing on the roll (a fourth "mode")
const selectedIds = ref(new Set()) // playable-note indices selected in edit mode
const undoStack = ref([]) // edit snapshots ({ key,bpm,timeSig,lines }), cap 30
const clipboard = ref(null) // copied events, relative to their earliest start
const GRID = 0.25 // edit snap grid, in beats
const LEN_PRESETS = [['⅛', 0.125], ['¼', 0.25], ['½', 0.5], ['¾', 0.75], ['1', 1], ['1½', 1.5], ['2', 2], ['4', 4]]
const liveEdit = ref(null) // edited { key,bpm,timeSig,lines } shown live during a drag
const uiIdx = ref(0) // reactive mirror of the current note index (UI only)
const pitch = ref(null) // latest mic pitch { name, midi, cents, freq, midiFloat }
const tipText = ref('')
const toastMsg = ref('')
const nameDraft = ref('')
const imageUrl = ref('')

// ── Takes ───────────────────────────────────────────────────────────────────
const takes = ref([])
const recording = ref(false)
const takesOpen = ref(false)
let takeSeq = 0
let recStartedAt = 0
const recorder = new TakeRecorder()

// ── Import ──────────────────────────────────────────────────────────────────
const importOpen = ref(false)
const importCreating = ref(false)
const importError = ref('')

// ── Lyrics pass ─────────────────────────────────────────────────────────────
const lyricsOpen = ref(false)
const lyricsApplying = ref(false)
const imageDataUris = new Map() // score id → data URI, so a re-run doesn't refetch

// ── Streaming draft (image conversion in progress, not yet persisted) ────────
const draft = ref(null)
const streamProgress = ref({ lines: 0, reasoning: false })
let streamAbort = null

// ── Stream trace ────────────────────────────────────────────────────────────
// Every AI run reports what it sent and everything that came back. A run that
// produces nothing used to be indistinguishable from a slow model; this is the
// record that tells them apart, and it survives the run so a failure can still
// be read afterwards.
const TRACE_CAP = 600 // entries
const TRACE_CHUNK = 8000 // chars before a streaming delta starts a new entry
const logOpen = ref(false)
const traceLog = ref([])
const tracePrompt = ref('')
const traceStats = ref({})
const lyricsRunning = ref(false)
const traceClock = ref(0)

function beginTrace() {
  traceLog.value = []
  tracePrompt.value = ''
  traceStats.value = {}
}
function clearTrace() {
  beginTrace()
  logOpen.value = false
}
let lastStatsAt = 0
function pushTrace(e) {
  // Content and reasoning fire per token. Mirroring the counters on every one of
  // them would re-render the strip thousands of times, so they get throttled;
  // every other event (rows, errors, finish) updates immediately.
  const chatty = e.kind === 'content' || e.kind === 'reasoning'
  if (!chatty || Date.now() - lastStatsAt > 120) {
    traceStats.value = { ...e.stats }
    lastStatsAt = Date.now()
  }
  if (e.kind === 'prompt') {
    tracePrompt.value = e.text
    return
  }
  const log = traceLog.value
  const last = log[log.length - 1]
  // Content and reasoning arrive token by token — thousands of entries. Grow the
  // last one instead, so the panel reads like the model typing.
  if (last && last.kind === e.kind && (e.kind === 'content' || e.kind === 'reasoning') && last.text.length < TRACE_CHUNK) {
    last.text += e.text
    return
  }
  log.push({ at: e.at, kind: e.kind, text: e.text })
  if (log.length > TRACE_CAP) log.splice(0, log.length - TRACE_CAP)
}

// ── DOM refs ────────────────────────────────────────────────────────────────
const fluteRoll = ref(null) // the desktop deck (BawuFluteRoll) — driven by the loop
const rollElPhone = ref(null)
const laneElPhone = ref(null)
const nowElPhone = ref(null)
const pageImgWrap = ref(null)
const ppSheetEl = ref(null)

// Phone-landscape roll height, kept in a ref because its expression overlay is
// drawn in real pixels (an SVG viewBox would distort the arcs).
const rollHPhone = ref(0)

// ── Score derived data ──────────────────────────────────────────────────────
const score = computed(() => draft.value || store.activeScore)
const isDraft = computed(() => !!draft.value)
const streaming = computed(() => !!draft.value?.streaming)
const progressLabel = computed(() => {
  const n = streamProgress.value.lines
  const est = draft.value?.expectedLines
  if (est) return `line ${n} / ~${est}`
  return n ? `${n} ${n === 1 ? 'line' : 'lines'}` : ''
})
const progressPct = computed(() => {
  const est = draft.value?.expectedLines
  if (!est) return null
  return Math.max(5, Math.min(100, (streamProgress.value.lines / est) * 100))
})

// What the loader actually says. "Transcribing…" for ten minutes tells you
// nothing, so the phases separate uploading, waiting, thinking and writing —
// and a stall is called out the moment the bytes stop rather than looking like
// more of the same.
function shortMs(ms) {
  if (!ms || ms < 0) return '0s'
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}
function shortBytes(n) {
  if (!n) return '0 B'
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
const streamPhase = computed(() => {
  traceClock.value // re-evaluate on the tick, not just on new data
  const s = traceStats.value
  const el = s.startedAt ? Date.now() - s.startedAt : 0
  const quiet = s.lastByteAt ? Date.now() - s.lastByteAt : 0
  const stalled = !!s.startedAt && quiet > 20000
  const chars = (s.contentChars || 0).toLocaleString()

  let text = 'Sending the picture…'
  let detail = ''
  let hint = `${shortBytes(s.imageChars)} · ${s.model || ''}`

  if (s.firstByteMs == null && el > 1500) {
    text = 'Waiting for the model…'
    hint = `nothing back after ${shortMs(el)}`
  } else if (s.firstByteMs != null && !s.contentChars && s.reasoningChars) {
    text = 'Thinking before it answers…'
    detail = `~${Math.round(s.reasoningChars / 4).toLocaleString()} tokens`
    hint = `${shortMs(el)} in · no answer yet`
  } else if (s.firstByteMs != null && !s.contentChars) {
    text = 'Connected — waiting for the first note…'
    hint = shortMs(el) + ' in'
  } else if (!s.rows) {
    text = 'Reading the score…'
    detail = `${chars} chars`
    hint = `${shortMs(el)} in · nothing has parsed yet`
  } else {
    text = 'Transcribing…'
    detail = progressLabel.value
    // Some models never touch the answer channel and put the whole score in
    // their reasoning — worth saying, because the "out" counter stays at zero.
    hint = s.rowsFromReasoning && !s.contentChars
      ? `${shortMs(el)} · reading it out of the model's reasoning`
      : `${shortMs(el)} · ${chars} chars`
  }
  if (stalled) hint = `stalled — nothing for ${shortMs(quiet)}`
  return { text, detail, hint, stalled }
})
const variant = ref('original') // 'original' | 'adjusted'
const adjusted = computed(() => (isDraft.value ? null : score.value?.data?.adjusted || null))
const activeData = computed(() => {
  if (liveEdit.value) return liveEdit.value
  const d = score.value?.data
  if (!d) return null
  if (variant.value === 'adjusted' && adjusted.value) {
    return { ...d, key: adjusted.value.key, bpm: adjusted.value.bpm || d.bpm, timeSig: adjusted.value.timeSig || d.timeSig, lines: adjusted.value.lines }
  }
  return d
})

const keyName = computed(() => canonicalKey(activeData.value?.key) || 'F')
const keyLabel = computed(() => KEYS[keyName.value]?.label || keyName.value)
// The key the score was imported in (immutable; setKey never changes it). Older
// scores predate the field, so fall back to their current key.
const origKey = computed(() =>
  isDraft.value ? null : canonicalKey(score.value?.data?.origKey || score.value?.data?.key) || null,
)
// When the original key isn't one of the standard transpose buttons, it gets
// added as its own button rather than being unreachable.
const extraOrigKey = computed(() =>
  origKey.value && !KEY_CHOICES.includes(origKey.value) ? origKey.value : null,
)
const flat = computed(() =>
  activeData.value ? flattenScore(activeData.value) : { key: 'F', notes: [], playable: [], totalBeats: 0 },
)
const playableNotes = computed(() => flat.value.playable)
const laneNotes = computed(() => flat.value.notes.filter((n) => !n.rest))
// A pinyin-only result still counts as lyrics, or the toggle would never light.
const lyricsPresent = computed(() => flat.value.notes.some((n) => n.ly || n.py))
const totalBeats = computed(() => flat.value.totalBeats)
const beatsPerBar = computed(() => {
  const m = (activeData.value?.timeSig || '4/4').match(/^(\d+)\//)
  return m ? Math.max(1, Number(m[1])) : 4
})
const barCount = computed(() => Math.max(1, Math.ceil((totalBeats.value + 0.01) / beatsPerBar.value)))

// ── Roll scale ──────────────────────────────────────────────────────────────
// The roll stretches to fit the shortest note in the piece rather than squashing
// short notes: at a fixed 90px/beat a 1/16 was 14px wide — too small for its
// label and indistinguishable from a 1/8. So a piece with 1/16s simply gets a
// wider beat, and everything (bars, spacing, scroll speed) grows with it.
// The shortest duration the piece actually leans on — a lone grace note or one
// stray 1/32 shouldn't stretch the whole roll, so a duration has to turn up in
// at least 5% of the notes before it sets the scale.
const shortestBeats = computed(() => {
  const notes = laneNotes.value
  const counts = new Map()
  for (const n of notes) if (n.beats > 0) counts.set(n.beats, (counts.get(n.beats) || 0) + 1)
  const durations = [...counts.keys()].sort((a, b) => a - b)
  if (!durations.length) return 1
  const floor = Math.max(1, notes.length * 0.05)
  return durations.find((d) => counts.get(d) >= floor) ?? durations[0]
})
const fitPxPerBeat = computed(() => {
  const fit = (MIN_NOTE_PX + NOTE_GAP) / shortestBeats.value
  return Math.min(PX_MAX, Math.max(PX_MIN, fit))
})
// Frozen while editing: re-fitting the scale to the shortest note as you type
// makes everything else on the roll jump around mid-edit, so hold the scale
// still until you leave edit mode, then let it snap back to fit.
const frozenFitPx = ref(fitPxPerBeat.value)
watch(fitPxPerBeat, (v) => { if (!editMode.value) frozenFitPx.value = v })
const PX = computed(() => Math.round((editMode.value ? frozenFitPx.value : fitPxPerBeat.value) * rollZoom.value))
// The same fit, on the vertical scale the standing roll uses.
const fitPxPerBeatV = computed(() =>
  Math.min(PXV_MAX, Math.max(PXV_MIN, MIN_NOTE_PXV / shortestBeats.value)),
)
const frozenFitPxV = ref(fitPxPerBeatV.value)
watch(fitPxPerBeatV, (v) => { if (!editMode.value) frozenFitPxV.value = v })
const PXV = computed(() => Math.round((editMode.value ? frozenFitPxV.value : fitPxPerBeatV.value) * rollZoom.value))
function zoomRoll(delta) {
  rollZoom.value = Math.min(2, Math.max(0.5, Math.round((rollZoom.value + delta) * 100) / 100))
}

const laneWidth = computed(() => Math.max(400, totalBeats.value * PX.value + 200))
const currentNote = computed(() => playableNotes.value[uiIdx.value] || null)
const lineCount = computed(() => score.value?.data?.lines?.length || 0)
const hasPicture = computed(() => (isDraft.value ? !!draft.value.previewUrl : !!score.value?.image_path))
const showJianpu = computed(() => !hasPicture.value || scoreView.value === 'jianpu')

const aiMeta = computed(() => (isDraft.value ? draft.value._meta : score.value?.ai_meta) || null)
const aiModelId = computed(() => aiMeta.value?.model || (isDraft.value ? draft.value._model : '') || '')
const aiModelLabel = computed(() => {
  const id = aiModelId.value
  if (!id) return ''
  return MODELS.find((m) => m.id === id)?.label || id
})
const aiModelTitle = computed(() => {
  const id = aiModelId.value
  if (!id) return ''
  const parts = [`Transcribed by ${id}`]
  const eff = aiMeta.value?.effort
  if (eff) parts.push(`${EFFORTS.find((e) => e.id === eff)?.label || eff} effort`)
  const cost = aiMeta.value?.usage?.cost
  if (typeof cost === 'number') parts.push(`$${cost.toFixed(4)}`)
  return parts.join(' · ')
})
const fit = computed(() => (activeData.value ? fitInfo(activeData.value, keyName.value) : { fits: true, missing: 0, total: 0 }))
const scoreBpm = computed(() => activeData.value?.bpm || 80)
const tempoPct = computed(() => Math.round((bpm.value / scoreBpm.value) * 100))
const targetNote = computed(() => {
  const cur = currentNote.value
  if (!cur || cur.row === null) return null
  return { jp: cur.label, pitch: BAWU_NOTES[cur.row].pitch }
})

// Jianpu sheet rendering (grouped back into lines, rests kept).
const jianpuLines = computed(() => {
  const lines = []
  for (const n of flat.value.notes) {
    if (!lines[n.lineIdx]) lines[n.lineIdx] = []
    lines[n.lineIdx].push(n)
  }
  return lines.filter(Boolean)
})

const matchedScores = computed(() => {
  const q = railQuery.value.trim().toLowerCase()
  if (!q) return store.scores
  return store.scores.filter((s) => s.name.toLowerCase().includes(q))
})
const visibleFolders = computed(() => {
  if (!railQuery.value.trim()) return store.folders
  return store.folders.filter((f) => matchedScores.value.some((s) => s.folder_id === f.id))
})
const ungroupedScores = computed(() =>
  matchedScores.value.filter((s) => !s.folder_id || !store.folders.some((f) => f.id === s.folder_id)),
)
// Order that mirrors what's actually on screen (collapsed folders' scores are skipped),
// so shift-click range selection matches what the user visually sees.
const flatVisibleScores = computed(() => {
  const out = []
  for (const f of visibleFolders.value) {
    if (isExpanded(f.id)) out.push(...folderScores(f.id))
  }
  out.push(...ungroupedScores.value)
  return out
})

// ── Resizable roll ↔ score-panel split ──────────────────────────────────────
const MIN_COL = 260
const colWidth = ref(Math.max(MIN_COL, Number(localStorage.getItem('bawu.colWidth')) || 392))
// Only an inline width (and a divider) while the player is a side-by-side row;
// when it stacks (narrow desktop) the responsive CSS width takes over.
const wideDesk = computed(() => layout.value === 'desktop' && vw.value >= 1080)
const colStyle = computed(() => (wideDesk.value ? { width: colWidth.value + 'px' } : {}))
let colResize = null
function onColResizeDown(e) {
  e.preventDefault()
  colResize = { startX: e.clientX, startW: colWidth.value }
  window.addEventListener('pointermove', onColResizeMove)
  window.addEventListener('pointerup', onColResizeUp)
}
function onColResizeMove(e) {
  if (!colResize) return
  const dx = e.clientX - colResize.startX // dragging left widens the right-hand panel
  const max = Math.max(320, vw.value - 460)
  colWidth.value = Math.max(MIN_COL, Math.min(max, colResize.startW - dx))
}
function onColResizeUp() {
  window.removeEventListener('pointermove', onColResizeMove)
  window.removeEventListener('pointerup', onColResizeUp)
  colResize = null
  localStorage.setItem('bawu.colWidth', String(Math.round(colWidth.value)))
}

// ── Playback engine (non-reactive core, mirrored into refs for the UI) ─────
let t = 0 // song position in beats — also the edit cursor when paused
let curIdx = 0
let trigIdx = 0
let lastBeat = -1
let rafId = 0
let lastTs = 0
let stableStart = null
// The sound currently in the air. A tie or a slur is ONE sound spanning several
// notes, so the voice outlives the note that started it and gets glided rather
// than restruck; `glidePending` marks a portamento already scheduled ahead of
// time by a `go:'to'`, so the arriving note doesn't fire a second one over it.
let voice = null
let glidePending = false
let axisVoice = null // sustained tone while a fingering-axis row is held, piano-key style
const traceSamples = []
const tracker = new PitchTracker()
const micActive = computed(() => micOn.value || tunerOpen.value)

function releaseVoice(fade = 0.06) {
  if (voice) {
    voice.release(fade)
    voice = null
  }
  glidePending = false
}

function resetPlayback(toIdx = 0) {
  playing.value = false
  releaseVoice()
  curIdx = Math.max(0, Math.min(playableNotes.value.length - 1, toIdx))
  t = playableNotes.value[curIdx]?.start || 0
  syncTriggers()
  uiIdx.value = curIdx
}

function syncTriggers() {
  const notes = flat.value.notes
  trigIdx = 0
  while (trigIdx < notes.length && notes[trigIdx].start < t - 0.001) trigIdx++
  lastBeat = Math.floor(t) - 1
}

function noteDurSec(beats) {
  return Math.max(0.15, beats * (60 / bpm.value) * 0.9)
}

// The next entry in the flattened timeline that actually sounds.
function nextSounding(all, i) {
  for (let k = i + 1; k < all.length; k++) if (!all[k].rest && all[k].midi != null) return all[k]
  return null
}

// Sound one entry of the flattened timeline. A note the previous one tied or
// slurred into keeps the running voice and glides to the new pitch, so a phrase
// comes out as one breath instead of a row of separate blows.
function triggerNote(all, i) {
  const n = all[i]
  if (n.rest || n.midi == null) {
    releaseVoice()
    return
  }
  if (n.noAttack && voice && !voice.dead) {
    if (!glidePending) voice.glideTo(n.midi, n.tiedIn ? 0 : 0.06)
    voice.extendTo(noteDurSec(n.soundBeats))
    glidePending = false
  } else {
    releaseVoice()
    const prev = all[i - 1]
    const next = nextSounding(all, i)
    // A slurred note's envelope has to outlast its own beat, because the glide
    // that continues it only arrives when the next note is crossed.
    voice = playBawuTone(n.midi, noteDurSec(n.soundBeats) * (n.sl ? 1.3 : 1), {
      gi: n.gi,
      go: n.go,
      bd: n.bd,
      vb: n.vb,
      fromMidi: prev && !prev.rest ? prev.midi : null,
      nextMidi: next ? next.midi : null,
    })
  }

  // A portamento into the next note has to START before that note is due, so
  // schedule it now — but only when the two are joined. Unjoined, the tail bend
  // already baked into this note's own envelope is the whole gesture.
  const nxt = all[i + 1]
  if (n.go === 'to' && voice && nxt && !nxt.rest && nxt.noAttack) {
    const seg = noteDurSec(n.beats)
    voice.glideTo(nxt.midi, seg * 0.32, seg * 0.68)
    glidePending = true
  }
}

function frame(ts) {
  rafId = requestAnimationFrame(frame)
  const dt = Math.min(0.1, (ts - lastTs) / 1000 || 0)
  lastTs = ts

  const notes = playableNotes.value
  if (playing.value && notes.length) {
    if (mode.value === 'follow') {
      const target = notes[curIdx]?.start ?? t
      t += (target - t) * Math.min(1, dt * 9)
    } else {
      t += dt * (bpm.value / 60)
      const all = flat.value.notes
      while (trigIdx < all.length && all[trigIdx].start <= t) {
        triggerNote(all, trigIdx)
        trigIdx++
      }
      const beat = Math.floor(t)
      if (beat > lastBeat) {
        lastBeat = beat
        if (metroOn.value) playClick(beat % beatsPerBar.value === 0)
      }
      while (curIdx < notes.length - 1 && notes[curIdx + 1].start <= t) curIdx++
      if (t > totalBeats.value + 1) {
        if (streaming.value) {
          t = totalBeats.value
        } else {
          playing.value = false
          releaseVoice()
          showToast('End of piece')
        }
      }
    }
  }

  // Scroll position + playhead (direct DOM — no reactivity at 60fps).
  measureRoll()
  fluteRoll.value?.paint(t)
  paintRoll(laneElPhone.value, nowElPhone.value, rollElPhone.value, PLAYHEAD_X_PHONE, phoneView)

  if (uiIdx.value !== curIdx) uiIdx.value = curIdx
}

// Phone-landscape paint state — the desktop deck scrolls itself, so this is the
// only roll the loop still translates by hand. `page` is the screenful currently
// shown in line mode (-1 in scroll mode); the rest are the last values written,
// so the loop only touches the DOM when something actually changed.
const blankView = () => ({ lane: null, now: null, page: -1, laneX: null, lineX: null, trans: '' })
const phoneView = blankView()
const LANE_PAD = 24 // px of breathing room at the left edge in line mode

// Paint one roll for the current song position.
//   'roll' mode — the lane slides leftwards under a line pinned at `headX`.
//   'line' mode — the lane only moves when the page turns, so a CSS transition
//                 can animate the flip while the line still updates every frame.
function paintRoll(lane, now, roll, headX, view) {
  if (!lane) return
  if (view.lane !== lane || view.now !== now) {
    // A layout change swapped the elements out — repaint onto the new ones.
    Object.assign(view, blankView(), { lane, now })
  }
  let laneX
  let lineX = headX
  let trans = ''
  if (scrollStyle.value === 'line' && roll) {
    const pageW = Math.max(120, roll.clientWidth - LANE_PAD * 2)
    const pageBeats = pageW / PX.value
    const page = Math.max(0, Math.floor(t / pageBeats))
    laneX = LANE_PAD - page * pageBeats * PX.value
    lineX = LANE_PAD + (t - page * pageBeats) * PX.value
    trans = view.page < 0 ? '' : 'transform 220ms ease' // don't animate on entry
    view.page = page
  } else {
    laneX = headX - t * PX.value
    view.page = -1
  }
  if (view.trans !== trans) {
    lane.style.transition = trans
    view.trans = trans
  }
  if (view.laneX !== laneX) {
    lane.style.transform = `translateX(${laneX}px)`
    view.laneX = laneX
  }
  if (now && view.lineX !== lineX) {
    now.style.transform = `translateX(${lineX}px)`
    view.lineX = lineX
  }
}

// Roll geometry for the phone expression overlay, read off the live DOM — the
// ref is only written when the value actually changed.
function measureRoll() {
  const hp = rollElPhone.value?.clientHeight || 0
  if (rollHPhone.value !== hp) rollHPhone.value = hp
}

// ── Mic trace ───────────────────────────────────────────────────────────────
// The samples are drawn by the deck (BawuFluteRoll), which reads this array
// straight off the prop every frame; all this side does is keep it to the last
// six seconds, since nothing older is ever on screen.
const TRACE_WINDOW_MS = 6000

function onPitch(p) {
  pitch.value = p
  if (!p) {
    stableStart = null
    updateTip(null)
    return
  }
  const at = performance.now()
  traceSamples.push({ at, mf: p.midiFloat })
  while (traceSamples.length && at - traceSamples[0].at > TRACE_WINDOW_MS) traceSamples.shift()
  updateTip(p)

  if (mode.value === 'follow' && playing.value) {
    const cur = playableNotes.value[curIdx]
    if (cur && p.midi === cur.midi) {
      if (stableStart == null) stableStart = performance.now()
      if (performance.now() - stableStart >= 120) {
        stableStart = null
        advanceFollow()
      }
    } else {
      stableStart = null
    }
  }
}

function updateTip(p) {
  if (!p || mode.value !== 'follow' || !playing.value) {
    tipText.value = ''
    return
  }
  const cur = playableNotes.value[curIdx]
  if (!cur || cur.row === null) {
    tipText.value = ''
    return
  }
  const heardRow = rowOfMidi(p.midi)
  tipText.value = p.midi === cur.midi ? `${p.name} ✓` : `${p.name} → ${coachDelta(cur.row, heardRow)}`
}

function advanceFollow() {
  const notes = playableNotes.value
  if (curIdx >= notes.length - 1) {
    if (streaming.value) return
    playing.value = false
    uiIdx.value = curIdx
    showToast('Piece complete — well played! 🎉')
    return
  }
  curIdx++
  while (curIdx < notes.length - 1 && notes[curIdx].row === null) curIdx++
  uiIdx.value = curIdx
}

// ── Transport actions ───────────────────────────────────────────────────────
function togglePlay() {
  if (!playableNotes.value.length) return
  ensureAudio()
  if (playing.value) {
    playing.value = false
    releaseVoice()
    return
  }
  if (t > totalBeats.value) resetPlayback(0)
  syncTriggers()
  stableStart = null
  playing.value = true
  if (mode.value === 'follow' && !micOn.value) toggleMic()
}

function stopAll() {
  playing.value = false
  resetPlayback(0)
}

function goToStart() {
  resetPlayback(0)
  showToast('Back to start')
}

function stepBy(delta) {
  playing.value = false
  resetPlayback(curIdx + delta)
  const n = playableNotes.value[curIdx]
  if (n && n.midi != null) playBawuTone(n.midi, 0.4)
}

function onSeek(v) {
  playing.value = false
  resetPlayback(Number(v))
}

function jumpTo(n) {
  playing.value = false
  resetPlayback(n.idx)
  if (n.midi != null) playBawuTone(n.midi, 0.45)
}

function setMode(m) {
  if (mode.value === m) return
  mode.value = m
  playing.value = false
  releaseVoice()
  stableStart = null
  syncTriggers()
}

// Mode pill: picking a practice mode also leaves edit mode.
function selectMode(m) {
  if (editMode.value) exitEdit()
  setMode(m)
}

function toggleMetro() {
  metroOn.value = !metroOn.value
  if (metroOn.value) playClick(true)
}

// ── Mic / tuner ─────────────────────────────────────────────────────────────
async function ensureTracker() {
  if (micActive.value && !tracker.running) {
    try {
      await tracker.start(onPitch)
    } catch (e) {
      console.error('[Bawu] mic error:', e)
      micOn.value = false
      tunerOpen.value = false
      showToast(e?.name === 'NotAllowedError' ? 'Microphone permission denied' : 'Could not open the microphone')
    }
  } else if (!micActive.value && tracker.running) {
    tracker.stop()
    pitch.value = null
    traceSamples.length = 0
    tipText.value = ''
  }
}

function toggleMic() {
  micOn.value = !micOn.value
}

function toggleTuner() {
  tunerOpen.value = !tunerOpen.value
}

watch(micActive, ensureTracker)

// ── Takes ───────────────────────────────────────────────────────────────────
async function toggleRecord() {
  if (recording.value) {
    recording.value = false
    const blob = await recorder.stop()
    if (!blob) {
      showToast('Nothing captured')
      return
    }
    takeSeq++
    const secs = Math.max(1, Math.round((Date.now() - recStartedAt) / 1000))
    takes.value.push({
      id: 'take-' + takeSeq,
      name: `${score.value?.name || 'Take'} — take ${String(takeSeq).padStart(2, '0')}`,
      secs,
      url: URL.createObjectURL(blob),
      ext: takeExtension(recorder.mimeType),
    })
    takesOpen.value = true
    showToast('Take ready — session only, download to keep')
  } else {
    try {
      await recorder.start()
      recStartedAt = Date.now()
      recording.value = true
      setMode('steady')
      showToast('Recording take…')
    } catch (e) {
      console.error('[Bawu] record error:', e)
      showToast('Could not start recording')
    }
  }
}

function discardTake(id) {
  const idx = takes.value.findIndex((x) => x.id === id)
  if (idx === -1) return
  URL.revokeObjectURL(takes.value[idx].url)
  takes.value.splice(idx, 1)
}

// ── Score panel: where-are-we band on the picture ────────────────────────────
const contentBlock = computed(() => {
  const d = score.value?.data
  if (d && d.contentTop != null && d.contentBottom != null && d.contentBottom > d.contentTop) {
    return { top: d.contentTop, bottom: d.contentBottom }
  }
  return null
})
const lineBandFrac = computed(() => {
  const n = lineCount.value
  if (!n) return null
  const li = currentNote.value?.lineIdx ?? 0
  const block = contentBlock.value
  if (block) {
    const h = (block.bottom - block.top) / n
    const top = block.top + li * h
    return { top, bottom: top + h }
  }
  const line = score.value?.data?.lines?.[li]
  if (line && line.y0 != null && line.y1 != null) {
    return { top: Math.max(0, line.y0 - 0.005), bottom: Math.min(1, line.y1 + 0.005) }
  }
  const topPad = 0.12
  const usable = 0.82
  const top = topPad + (li / n) * usable
  return { top, bottom: top + Math.max(0.04, usable / n) }
})
const lineBandStyle = computed(() => {
  const b = lineBandFrac.value
  if (!b) return {}
  return { top: b.top * 100 + '%', height: Math.max(3, (b.bottom - b.top) * 100) + '%' }
})

const locLabel = computed(() => {
  const cur = currentNote.value
  if (!cur) return '—'
  const bar = Math.floor(cur.start / beatsPerBar.value) + 1
  return `line ${cur.lineIdx + 1} · bar ${bar} · ${cur.label}`
})

// ── Short coach line (practice toolbar) ──────────────────────────────────────
const modeHint = computed(() => {
  const cur = currentNote.value
  if (!cur) return 'No notes yet'
  if (cur.row === null) return `${cur.label} is out of the bawu's range`
  const covered = coveredLabel(cur.row)
  if (mode.value === 'follow') return `Song waits · play ${cur.label}, cover ${covered}`
  if (mode.value === 'steady') return `${bpm.value} BPM · ${cur.label}, cover ${covered}`
  return `${cur.label} (${BAWU_NOTES[cur.row].pitch}) · cover ${covered}`
})

// ── Roll note helpers ───────────────────────────────────────────────────────
const NOTE_NAMES_FLAT = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
function pitchName(midi) {
  return NOTE_NAMES_FLAT[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)
}
function noteLabel(n) {
  if (notation.value === 'western' && n.midi != null) return pitchName(n.midi)
  return n.label
}
// The phone-landscape pitch axis still labels its rows.
function axisBig(n) {
  return notation.value === 'western' ? n.pitch : jianpuText(n.midi, keyName.value)
}
function nearestRow(midi) {
  let best = 0
  let bestD = Infinity
  BAWU_NOTES.forEach((n, i) => {
    const d = Math.abs(n.midi - midi)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}
// A note's pill is exactly as long as it sounds — the gap that separates it from
// the next one shrinks with the note, so a 1/16 (0.25 beats) reads as a quarter
// of a 1/4 instead of both bottoming out at the same minimum width. The beat
// scale itself (`PX`) keeps even the shortest pill wide enough for its label.
function noteWidth(n) {
  const span = n.beats * PX.value
  // A tie's two halves are one sound, so no gap is cut between them.
  if (n.ti) return Math.max(span, 10)
  return Math.max(span - Math.min(NOTE_GAP, span * 0.18), 10)
}
// The lane row a note sits on. Unplayable pitches are shown on their nearest
// row (with a warning) rather than vanishing off the axis.
function noteRow(n) {
  return n.row === null ? nearestRow(n.midi ?? 69) : n.row
}
function noteClass(n) {
  const w = noteWidth(n)
  return {
    done: !editMode.value && n.idx < uiIdx.value,
    current: !editMode.value && n.idx === uiIdx.value,
    upcoming: !editMode.value && n.idx > uiIdx.value,
    unplayable: n.row === null,
    selected: isSelected(n),
    // The two halves of a tie butt together into one continuous pill.
    'tied-in': n.tiedIn,
    'ties-out': !!n.ti,
    tight: w < 46, // trim padding so the label still fits
    tiny: w < 20, // no room for a label at all
  }
}
function noteStyle(n) {
  return {
    left: n.start * PX.value + 'px',
    width: noteWidth(n) + 'px',
    top: ((noteRow(n) + 0.5) / BAWU_NOTES.length) * 100 + '%',
  }
}

// ── Expression overlay (phone landscape) ─────────────────────────────────────
// Arcs and diagonals don't come out of a stack of absolutely-positioned pills,
// so the marks are drawn as one SVG layer inside the lane. Everything is in
// lane pixels: x is beats × PX, y is the row's centre line, and the pill height
// decides how far off the note an arc or hook sits. (The desktop deck stands the
// roll on its end, where an arc has nowhere to go — it prints glyphs instead.)
function buildFxPaths(h, ph) {
  const notes = laneNotes.value
  if (!h || !notes.length) return []
  const px = PX.value
  const rows = BAWU_NOTES.length
  const half = ph / 2
  const yOf = (n) => ((noteRow(n) + 0.5) / rows) * h
  const out = []

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]
    const x0 = n.start * px
    const w = noteWidth(n)
    const x1 = x0 + w
    const cx = x0 + w / 2
    const y = yOf(n)
    const top = y - half

    if (n.bd) {
      const dir = n.bd < 0 ? 1 : -1
      out.push({ cls: 'fx-bend', d: `M${cx - 7} ${top - 5} q7 ${dir * 9} 14 0` })
    }
    if (n.vb) {
      const amp = 1.5 + n.vb
      const step = n.vb === 3 ? 4 : 6 // flutter is tighter and faster
      let d = `M${cx - step * 2} ${top - 5}`
      for (let k = 0; k < 4; k++) d += ` q${step / 2} ${(k % 2 ? 1 : -1) * amp} ${step} 0`
      out.push({ cls: 'fx-vib', d })
    }
    if (n.gi) {
      const prev = notes[i - 1]
      const up = !prev || prev.midi <= n.midi
      out.push({ cls: 'fx-gliss', d: `M${x0 - 15} ${y + (up ? 13 : -13)} L${x0 - 2} ${y}` })
    }
    if (n.go === 'off') {
      out.push({ cls: 'fx-gliss', d: `M${x1 + 2} ${y} L${x1 + 16} ${y + 14}` })
    }

    const next = notes[i + 1]
    if (!next) continue
    // Ties and slurs are already settled against the real neighbour by
    // flattenScore, so they always point at the note that follows here.
    const nx0 = next.start * px
    const ny = yOf(next)
    const nTop = ny - half
    const adjacent = Math.abs(next.start - (n.start + n.beats)) < 1e-4

    if (n.go === 'to' && adjacent) {
      out.push({ cls: 'fx-gliss', d: `M${x1 + 2} ${y} L${nx0 - 2} ${ny}` })
    }
    if (n.ti || n.sl) {
      const lift = n.ti ? 6 : 11
      const apex = Math.min(top, nTop) - lift
      if (n.ti) {
        // A tie joins the two noteheads, so it hugs the pills' facing edges.
        out.push({ cls: 'fx-tie', d: `M${x1 - 5} ${top - 2} Q${(x1 + nx0) / 2} ${apex} ${nx0 + 5} ${nTop - 2}` })
      } else {
        // A slur arches over the phrase, centre to centre.
        out.push({ cls: 'fx-slur', d: `M${cx} ${top - 3} Q${(cx + nx0 + noteWidth(next) / 2) / 2} ${apex} ${nx0 + noteWidth(next) / 2} ${nTop - 3}` })
      }
    }
  }
  return out
}
const fxPathsPhone = computed(() => buildFxPaths(rollHPhone.value, 25.6)) // .note.phone is 1.6rem

// ── Lyrics ───────────────────────────────────────────────────────────────────
// Either script falls back to the other, so a pinyin-only pass still shows
// something when 中文 is selected (and vice versa) — the karaoke band below and
// the deck's on-note syllables both read it that way.
const showBand = computed(() => lyricsOn.value && lyricsPosition.value === 'band' && lyricsPresent.value && !editMode.value)
const karaoke = computed(() => {
  const list = playableNotes.value.filter((n) => n.ly || n.py)
  if (!list.length) return []
  let ci = 0
  for (let k = 0; k < list.length; k++) if (list[k].idx <= uiIdx.value) ci = k
  const W = 4
  const out = []
  for (let i = ci - W; i <= ci + W; i++) {
    const n = list[i]
    if (!n) continue
    const primary = lyricsScript.value === 'pinyin' ? (n.py || n.ly) : (n.ly || n.py)
    const secondary = lyricsScript.value === 'pinyin' ? (n.py ? n.ly : '') : (n.ly ? n.py : '')
    out.push({ i, t: primary, sub: secondary, cur: i === ci, dist: Math.abs(i - ci) })
  }
  return out
})

// ── Picture zoom ─────────────────────────────────────────────────────────────
function zoomBy(delta) {
  picZoom.value = Math.max(0.5, Math.min(3, Math.round((picZoom.value + delta) * 100) / 100))
}

// ── On-pane note editing ─────────────────────────────────────────────────────
// The gestures themselves live in BawuFluteRoll, which knows the geometry; this
// side owns what they mean — the undo stack, where an edit is saved, and what it
// sounds like.
let lastAddBeats = 1
let lastPreviewMidi = null

// Audition a note the way a piano roll does — on click, on drop, and as a drag
// crosses into a new row. Guarded on the pitch actually changing so dragging
// sideways doesn't machine-gun the synth.
function previewTone(midi, force = false) {
  if (!auditionOn.value || midi == null) return
  if (!force && midi === lastPreviewMidi) return
  lastPreviewMidi = midi
  playBawuTone(midi, 0.4)
}
function endPreview() {
  lastPreviewMidi = null
}

// The instrument's holes double as piano keys: press one to hear what covering
// down to it sounds like, release to stop — a long scheduled duration cut short
// by release(). A bare tap still gets a minimum audible sustain rather than a
// click-length blip.
const AXIS_MIN_HOLD_MS = 330
let axisPressedAt = 0
function onRollHold(midi) {
  if (midi == null) return
  ensureAudio()
  if (axisVoice) axisVoice.release(0.02)
  axisVoice = playBawuTone(midi, 30)
  axisPressedAt = performance.now()
  window.addEventListener('pointerup', onAxisPointerUp)
  window.addEventListener('pointercancel', onAxisPointerUp)
}
function onAxisPointerUp() {
  window.removeEventListener('pointerup', onAxisPointerUp)
  window.removeEventListener('pointercancel', onAxisPointerUp)
  const v = axisVoice
  if (!v) return
  const wait = AXIS_MIN_HOLD_MS - (performance.now() - axisPressedAt)
  const release = () => { v.release(0.08); if (axisVoice === v) axisVoice = null }
  if (wait > 0) setTimeout(release, wait)
  else release()
}

function enterEdit() {
  playing.value = false
  releaseVoice()
  editMode.value = true
  selectedIds.value = new Set()
  endPreview()
  if (hasPicture.value && !isDraft.value) scoreView.value = 'jianpu'
}
function exitEdit() {
  editMode.value = false
  selectedIds.value = new Set()
  fluteRoll.value?.closeMenu()
  endPreview()
  mode.value = 'listen'
}
function toggleEdit() {
  editMode.value ? exitEdit() : enterEdit()
}

function editableBase() {
  const d = activeData.value || { key: 'F', bpm: 80, timeSig: '4/4', lines: [] }
  return JSON.parse(JSON.stringify({ key: d.key, bpm: d.bpm, timeSig: d.timeSig, lines: d.lines || [] }))
}

function commitEdit(newData) {
  const s = store.activeScore
  if (isDraft.value) {
    draft.value.data = { ...draft.value.data, key: newData.key, bpm: newData.bpm, timeSig: newData.timeSig, lines: newData.lines }
    return
  }
  if (!s) return
  const keepOriginal = variant.value === 'adjusted' || (hasPicture.value && s.source === 'image')
  if (keepOriginal) {
    const adj = { key: newData.key, bpm: newData.bpm, timeSig: newData.timeSig, lines: newData.lines }
    store.updateScoreData(s.id, { ...s.data, adjusted: adj })
    if (variant.value !== 'adjusted') variant.value = 'adjusted'
  } else {
    store.updateScoreData(s.id, { ...s.data, key: newData.key, bpm: newData.bpm, timeSig: newData.timeSig, lines: newData.lines })
  }
}

// Undo snapshots (cap 30).
function snapshotUndo(data) {
  undoStack.value = [...undoStack.value, data].slice(-30)
}
function pushUndo() {
  snapshotUndo(editableBase())
}
function undo() {
  const st = undoStack.value
  if (!st.length) return
  const prev = st[st.length - 1]
  undoStack.value = st.slice(0, -1)
  commitEdit(prev)
  selectedIds.value = new Set()
}

// Selection.
function isSelected(n) {
  return editMode.value && selectedIds.value.has(n.idx)
}
function clearSelection() {
  selectedIds.value = new Set()
}
const selNotes = computed(() => [...selectedIds.value].map((i) => playableNotes.value[i]).filter(Boolean))
const selCount = computed(() => selectedIds.value.size)
const selLabel = computed(() => {
  const n = selNotes.value
  if (!n.length) return 'Nothing selected'
  if (n.length === 1) return `Note ${n[0].label}`
  return `${n.length} notes`
})
const selDeg = computed(() => { const n = selNotes.value; return n.length === 1 ? degOctAccOfMidi(n[0].midi, keyName.value).deg : null })
const selRowLabel = computed(() => { const n = selNotes.value; return n.length === 1 ? BAWU_NOTES[nearestRow(n[0].midi)].pitch : '—' })
const selLenActive = computed(() => { const n = selNotes.value; return n.length === 1 ? n[0].beats : null })
const selSyl = computed(() => { const n = selNotes.value; if (n.length !== 1) return ''; return lyricsScript.value === 'pinyin' ? (n[0].py || n[0].ly) : n[0].ly })

// Apply a mutation to every selected event, re-serialize, and keep the selection.
function mutateSelectedEvents(fn) {
  if (!editMode.value || !selectedIds.value.size) return
  pushUndo()
  const base = editableBase()
  const events = dataToEvents(base)
  const touched = []
  ;[...selectedIds.value].forEach((i) => {
    const ev = events[i]
    if (ev) { fn(ev); touched.push(ev) }
  })
  const data = eventsToData(events, base, beatsPerBar.value)
  commitEdit(data)
  selectedIds.value = new Set(touched.map((ev) => rankOfEvent(events, ev)))
}

function setSelDegree(d) {
  let heard = null
  mutateSelectedEvents((ev) => {
    const { oct } = degOctAccOfMidi(ev.midi, keyName.value)
    ev.midi = midiOf(d, oct, keyName.value)
    if (heard == null) heard = ev.midi
  })
  previewTone(heard, true)
}
function shiftSelRow(rowDelta) {
  let heard = null
  mutateSelectedEvents((ev) => {
    const r = nearestRow(ev.midi)
    const nr = Math.max(0, Math.min(BAWU_NOTES.length - 1, r + rowDelta))
    ev.midi = BAWU_NOTES[nr].midi
    if (heard == null) heard = ev.midi
  })
  previewTone(heard, true)
}

// ── Expression marks (edit inspector) ────────────────────────────────────────
const vibChoices = [
  { n: 0, lab: '—', title: 'No vibrato' },
  { n: 1, lab: '〜', title: 'Gentle vibrato (虚指颤音)' },
  { n: 2, lab: '≈', title: 'Wide vibrato' },
  { n: 3, lab: '≋', title: 'Flutter tongue (花舌)' },
]
// What the selection currently carries. A field only reads as "on" when every
// selected note agrees, so a mixed selection shows nothing set and one press
// applies the mark to all of them.
const selFx = computed(() => {
  const n = selNotes.value
  if (!n.length) return { ti: 0, sl: 0, gi: 0, go: '', bd: 0, vb: 0 }
  const all = (fn) => n.every(fn)
  return {
    ti: all((x) => x.ti) ? 1 : 0,
    sl: all((x) => x.sl) ? 1 : 0,
    gi: all((x) => x.gi) ? 1 : 0,
    go: all((x) => x.go === n[0].go) ? n[0].go : '',
    bd: all((x) => x.bd === n[0].bd) ? n[0].bd : 0,
    vb: all((x) => x.vb === n[0].vb) ? n[0].vb : 0,
  }
})
const selHasFx = computed(() => selNotes.value.some((n) => n.ti || n.sl || n.gi || n.go || n.bd || n.vb))
// A tie needs a next note at the same pitch, touching this one — otherwise the
// serializer would only drop it again, so don't offer it.
const canTie = computed(() => {
  const sel = selNotes.value
  if (!sel.length) return false
  const all = flat.value.notes
  return sel.every((n) => {
    const next = all[all.indexOf(n) + 1]
    return next && !next.rest && next.midi === n.midi
  })
})

function toggleSelTie() {
  if (!canTie.value) return
  const on = !selFx.value.ti
  mutateSelectedEvents((ev) => { ev.ti = on ? 1 : 0; if (on) ev.sl = 0 })
}
function toggleSelSlur() {
  const on = !selFx.value.sl
  mutateSelectedEvents((ev) => { ev.sl = on ? 1 : 0; if (on) ev.ti = 0 })
}
function toggleSelGlissIn() {
  const on = !selFx.value.gi
  mutateSelectedEvents((ev) => { ev.gi = on ? 1 : 0 })
}
function setSelGlideOut(kind) {
  const on = selFx.value.go !== kind
  mutateSelectedEvents((ev) => { ev.go = on ? kind : '' })
}
function stepSelBend(delta) {
  const next = Math.max(-MAX_BEND, Math.min(MAX_BEND, (selFx.value.bd || 0) + delta))
  mutateSelectedEvents((ev) => { ev.bd = next })
}
function setSelVibrato(v) {
  const next = selFx.value.vb === v ? 0 : Math.max(0, Math.min(MAX_VIBRATO, v))
  mutateSelectedEvents((ev) => { ev.vb = next })
}
function clearSelFx() {
  mutateSelectedEvents((ev) => {
    ev.ti = 0
    ev.sl = 0
    ev.gi = 0
    ev.go = ''
    ev.bd = 0
    ev.vb = 0
  })
}
function setSelLength(beats) {
  mutateSelectedEvents((ev) => { ev.beats = beats; lastAddBeats = beats })
}
function setSelLengthDelta(d) {
  mutateSelectedEvents((ev) => { ev.beats = Math.max(MIN_BEATS, snapBeat(ev.beats + d, GRID)); lastAddBeats = ev.beats })
}
function setSelLyric(val) {
  mutateSelectedEvents((ev) => {
    if (lyricsScript.value === 'pinyin') ev.py = val
    else ev.ly = val
  })
}
function deleteSelection() {
  if (!editMode.value || !selectedIds.value.size) return
  pushUndo()
  const base = editableBase()
  const events = dataToEvents(base)
  const keep = events.filter((_, i) => !selectedIds.value.has(i))
  commitEdit(eventsToData(keep, base, beatsPerBar.value))
  selectedIds.value = new Set()
  if (uiIdx.value >= keep.length) resetPlayback(0)
}

// Clipboard: copy selected events (relative to their earliest start); paste at
// the playhead/cursor, preserving relative offsets and advancing the cursor.
function copySelection() {
  const base = editableBase()
  const events = dataToEvents(base)
  const sel = [...selectedIds.value].map((i) => events[i]).filter(Boolean)
  if (!sel.length) return
  const min = Math.min(...sel.map((e) => e.start))
  // Spread rather than list the fields: lyrics and every expression mark come
  // along, and a new one added later doesn't silently get dropped on paste.
  clipboard.value = sel.map((e) => ({ ...e, start: e.start - min }))
  showToast(`${sel.length} ${sel.length === 1 ? 'note' : 'notes'} copied`)
}
function pasteSelection() {
  pasteAt(snapBeat(t, GRID))
}
// Paste anchored anywhere — the transport cursor from ⌘V, or the spot the
// right-click menu was opened on.
function pasteAt(at) {
  const clip = clipboard.value
  if (!clip || !clip.length) return
  pushUndo()
  const base = editableBase()
  const events = dataToEvents(base)
  const pasted = clip.map((c, k) => ({ ...c, id: 'p' + Date.now() + k, start: at + c.start }))
  const all = [...events, ...pasted]
  commitEdit(eventsToData(all, base, beatsPerBar.value))
  selectedIds.value = new Set(pasted.map((ev) => rankOfEvent(all, ev)))
  t = Math.max(...pasted.map((p) => p.start + p.beats))
}

// A fresh event with every optional field explicitly empty, so a new note never
// inherits an expression mark from whatever shape it was built out of.
function newEvent(id, start, beats, midi) {
  return { id, start, beats, midi, art: '', ly: '', py: '', ti: 0, sl: 0, gi: 0, go: '', bd: 0, vb: 0 }
}

// Step entry: keys 1–7 drop a note at the cursor and advance it.
function stepInsert(deg) {
  if (!score.value) return
  pushUndo()
  const base = editableBase()
  const events = dataToEvents(base)
  const start = snapBeat(t, GRID)
  const midi = midiOf(deg, 0, keyName.value)
  const beats = lastAddBeats
  const ev = newEvent('s' + Date.now(), start, beats, midi)
  events.push(ev)
  commitEdit(eventsToData(events, base, beatsPerBar.value))
  selectedIds.value = new Set([rankOfEvent(events, ev)])
  previewTone(midi, true)
  t = start + beats
}

// ── Deck events ─────────────────────────────────────────────────────────────
// BawuFluteRoll works out where a gesture landed and hands back a finished
// score; everything below decides what that means for the sheet.
function onRollCommit({ data, base, select }) {
  playing.value = false
  if (base) snapshotUndo(base)
  commitEdit(data)
  selectedIds.value = new Set(select || [])
}
function onRollAudition({ midi, force }) {
  previewTone(midi, force)
}
// Scrolling the deck by hand moves the song position with it, so the NOW line
// always means what it says and the transport stays in step.
function onRollSeekBeat(beat) {
  if (playing.value) return
  t = beat
  const notes = playableNotes.value
  let i = 0
  while (i < notes.length - 1 && notes[i + 1].start <= t + 1e-6) i++
  curIdx = notes.length ? i : 0
  uiIdx.value = curIdx
  syncTriggers()
}

// New empty sheet → straight into edit mode.
async function createBlankSheet(key = 'F') {
  newSheetKeyMenu.value = false
  try {
    const saved = await store.createScore({
      name: 'New sheet',
      source: 'manual',
      data: { key, bpm: 80, timeSig: '4/4', lines: [{ notes: [] }] },
    })
    if (saved?.id) {
      store.selectScore(saved.id)
      importOpen.value = false
      railOpen.value = false
      enterEdit()
      showToast('Blank sheet — right-click the roll to add a note, or press 1–7')
    }
  } catch (e) {
    console.error('[Bawu] blank sheet failed:', e)
    showToast(e.message || 'Could not create the sheet')
  }
}

// ── Score CRUD glue ─────────────────────────────────────────────────────────
function noteCount(s) {
  let c = 0
  for (const line of s.data?.lines || []) for (const n of line.notes || []) if (n.deg) c++
  return c
}

function shortAgo(ts) {
  const d = dayjs(ts)
  const mins = dayjs().diff(d, 'minute')
  if (mins < 1) return 'now'
  if (mins < 60) return mins + 'm'
  const hours = dayjs().diff(d, 'hour')
  if (hours < 24) return hours + 'h'
  const days = dayjs().diff(d, 'day')
  if (days < 30) return days + 'd'
  return d.format('MMM D')
}

function selectScore(id) {
  if (draft.value) discardDraft()
  store.selectScore(id)
  railOpen.value = false
}

function railItemClick(ev, s) {
  if (ev.shiftKey) {
    const flat = flatVisibleScores.value
    const anchor = flat.findIndex((x) => x.id === (railLastClickedId.value ?? s.id))
    const here = flat.findIndex((x) => x.id === s.id)
    if (anchor === -1 || here === -1) {
      railSelectedIds.value = new Set([s.id])
    } else {
      const [lo, hi] = anchor < here ? [anchor, here] : [here, anchor]
      railSelectedIds.value = new Set(flat.slice(lo, hi + 1).map((x) => x.id))
    }
    railLastClickedId.value = s.id
    return
  }
  if (ev.ctrlKey || ev.metaKey) {
    const next = new Set(railSelectedIds.value)
    if (next.has(s.id)) next.delete(s.id)
    else next.add(s.id)
    railSelectedIds.value = next
    railLastClickedId.value = s.id
    return
  }
  railSelectedIds.value = new Set()
  railLastClickedId.value = s.id
  selectScore(s.id)
}

function clearRailSelection() {
  railSelectedIds.value = new Set()
}

async function deleteRailSelected() {
  const ids = [...railSelectedIds.value]
  if (!ids.length) return
  if (!confirm(`Delete ${ids.length} selected score${ids.length === 1 ? '' : 's'}? The original pictures are removed too.`)) return
  for (const id of ids) {
    try {
      await store.deleteScore(id)
    } catch (e) {
      console.error('[Bawu] bulk delete error:', e)
    }
  }
  railSelectedIds.value = new Set()
}

function setKey(k) {
  if (!score.value) return
  if (isDraft.value) {
    draft.value.data.key = k
    return
  }
  variant.value = 'original'
  if (score.value.data.key !== k) {
    store.updateScoreData(score.value.id, { ...score.value.data, key: k })
  }
}

// The score's actual tempo (saved with the sheet) — distinct from the
// practice-mode BPM slider, which is just a playback-speed multiplier that
// resets to this value whenever you switch scores.
function setScoreBpm(v) {
  if (!score.value) return
  const n = Math.max(20, Math.min(300, Math.round(v)))
  if (isDraft.value) {
    draft.value.data.bpm = n
  } else if (score.value.data.bpm !== n) {
    store.updateScoreData(score.value.id, { ...score.value.data, bpm: n })
  }
  bpm.value = n
}

function selectAdjusted() {
  if (!adjusted.value || variant.value === 'adjusted') return
  variant.value = 'adjusted'
  scoreView.value = 'jianpu'
}

async function copyJianpu() {
  if (!activeData.value || !laneNotes.value.length) return
  try {
    await navigator.clipboard.writeText(scoreToJianpuText(activeData.value))
    showToast('Jianpu copied — paste it anywhere to edit')
  } catch {
    showToast('Could not access the clipboard')
  }
}

// ── Adjust-jianpu editor ─────────────────────────────────────────────────────
const editorOpen = ref(false)
const savingAdjust = ref(false)
function openEditor() {
  if (!score.value || isDraft.value || !laneNotes.value.length) return
  editorOpen.value = true
}
async function persistAdjusted(data, { toast, jianpuView = false } = {}) {
  const s = store.activeScore
  if (!s) return
  savingAdjust.value = true
  try {
    const adj = { key: data.key, bpm: data.bpm, timeSig: data.timeSig, lines: data.lines }
    await store.updateScore(s.id, { data: { ...s.data, adjusted: adj }, updated_at: new Date().toISOString() })
    variant.value = 'adjusted'
    if (jianpuView) scoreView.value = 'jianpu'
    if (toast) showToast(toast)
  } catch (e) {
    console.error('[Bawu] save adjusted failed:', e)
    showToast(e.message || 'Could not save the adjustment')
  } finally {
    savingAdjust.value = false
  }
}
async function saveAdjusted({ data }) {
  await persistAdjusted(data, { toast: 'Adjusted version saved', jianpuView: true })
  editorOpen.value = false
}
async function transpose(semitones) {
  if (!score.value || isDraft.value || !activeData.value || !laneNotes.value.length || savingAdjust.value) return
  const shifted = transposeData(activeData.value, semitones)
  await persistAdjusted(shifted, { toast: semitones > 0 ? 'Shifted up a semitone' : 'Shifted down a semitone' })
}

function saveName() {
  if (!score.value) return
  const name = nameDraft.value.trim()
  if (!name) {
    nameDraft.value = score.value.name
    return
  }
  if (isDraft.value) {
    draft.value.name = name
    return
  }
  if (name !== score.value.name) store.renameScore(score.value.id, name)
}

function removeScore() {
  if (!score.value) return
  if (isDraft.value) {
    discardDraft()
    return
  }
  if (!confirm(`Delete “${score.value.name}”? The original picture is removed too.`)) return
  store.deleteScore(score.value.id)
}

function exportMidi() {
  if (!activeData.value) return
  downloadMidi(activeData.value, keyName.value, score.value.name)
  showToast('MIDI downloaded')
}

function openImport() {
  importError.value = ''
  importOpen.value = true
}

// ── Lyrics pass ─────────────────────────────────────────────────────────────
// Reading the words is its own trip to the model, so it needs the original
// picture back — the edge function only transcribes from an image. That rules
// the pass out for hand-typed scores, which have no picture to read.
const canLyricsPass = computed(() => !isDraft.value && hasPicture.value && laneNotes.value.length > 0)

function openLyricsPass() {
  if (!canLyricsPass.value) return
  playing.value = false
  beginTrace()
  lyricsOpen.value = true
}

// The lyrics pass streams from inside its modal, so the view mirrors its state
// to keep the shared stream log ticking and readable after the modal closes.
function onLyricsRunning(on) {
  lyricsRunning.value = on
}

async function resolveScoreImage() {
  const s = store.activeScore
  if (!s?.image_path) return ''
  if (imageDataUris.has(s.id)) return imageDataUris.get(s.id)
  const url = imageUrl.value || (await store.getImageUrl(s.image_path))
  const uri = await urlToDataUri(url)
  imageDataUris.set(s.id, uri)
  return uri
}

// Write the result onto whichever transposition is on screen. Deliberately not
// routed through commitEdit(), which would fork a picture score into an
// "adjusted" variant — adding words is not an adjustment to the music.
async function applyLyrics({ rows, pinyin, overwrite }) {
  const s = store.activeScore
  if (!s || !activeData.value) return
  lyricsApplying.value = true
  try {
    const merged = mergeLyrics(activeData.value, rows, { overwrite })
    if (variant.value === 'adjusted' && adjusted.value) {
      const adj = { key: merged.key, bpm: merged.bpm, timeSig: merged.timeSig, lines: merged.lines }
      store.updateScoreData(s.id, { ...s.data, adjusted: adj })
    } else {
      store.updateScoreData(s.id, { ...s.data, lines: merged.lines })
    }
    lyricsOn.value = true
    // Only force the script over when there's nothing else to show — the user's
    // 中文 / Pīnyīn choice is otherwise theirs to keep.
    const chinese = rows.reduce((a, r) => a + r.ly.filter(Boolean).length, 0)
    const roman = rows.reduce((a, r) => a + r.py.filter(Boolean).length, 0)
    if (pinyin && roman && !chinese) lyricsScript.value = 'pinyin'
    lyricsOpen.value = false
    const n = Math.max(chinese, roman)
    showToast(`${n} ${n === 1 ? 'syllable' : 'syllables'} added`)
  } catch (e) {
    console.error('[Bawu] apply lyrics failed:', e)
    showToast(e.message || 'Could not save the lyrics')
  } finally {
    lyricsApplying.value = false
  }
}

async function createFromImport(payload) {
  importCreating.value = true
  importError.value = ''
  try {
    await store.createScore(payload)
    importOpen.value = false
    showToast(`Added “${payload.name}”`)
  } catch (e) {
    importError.value = e.message || 'Could not create the score.'
  } finally {
    importCreating.value = false
  }
}

// ── Streaming image conversion ───────────────────────────────────────────────
async function startStream(payload) {
  abortStream()
  clearDraft()
  importOpen.value = false
  playing.value = false

  const previewUrl = URL.createObjectURL(payload.imageBlob)
  draft.value = {
    id: '__draft__',
    name: payload.name || 'Transcribing…',
    source: 'image',
    data: { key: 'F', bpm: 80, timeSig: '4/4', lines: [] },
    streaming: true,
    truncated: false,
    error: '',
    expectedLines: null,
    previewUrl,
    _blob: payload.imageBlob,
    _dataUri: payload.dataUri,
    _model: payload.model,
    _effort: payload.effort,
    _mode: payload.mode || 'jianpu',
    _expression: !!payload.expression,
    _notes: payload.notes || '',
    _folderId: payload.folderId,
    _userName: payload.name,
    _meta: null,
  }
  streamProgress.value = { lines: 0, reasoning: false }
  beginTrace()

  streamAbort = new AbortController()
  try {
    const result = await convertImageStream(payload.dataUri, {
      model: payload.model,
      effort: payload.effort,
      mode: payload.mode || 'jianpu',
      expression: !!payload.expression,
      notes: payload.notes || '',
      signal: streamAbort.signal,
      onMeta: applyMeta,
      onLine: pushDraftLine,
      onProgress: (p) => { streamProgress.value = { ...streamProgress.value, lines: draft.value?.data.lines.length ?? p.lines } },
      onReasoning: () => { streamProgress.value = { ...streamProgress.value, reasoning: true } },
      onTrace: pushTrace,
      // Rows read out of a model's reasoning channel are provisional: if it
      // later answers properly, they were scratch work and get replaced.
      onReset: () => {
        if (!draft.value) return
        draft.value.data.lines = []
        streamProgress.value = { ...streamProgress.value, lines: 0 }
        resetPlayback(0)
      },
    })
    const d = draft.value
    if (!d) return
    d._meta = result.meta
    d.streaming = false
    if (result.truncated) {
      d.truncated = true
      showToast('Transcription may be incomplete')
    } else {
      await persistDraft()
    }
  } catch (e) {
    if (e?.name === 'AbortError') return
    console.error('[Bawu] stream failed:', e)
    if (draft.value) {
      draft.value.streaming = false
      draft.value.error = e.message || 'Transcription failed.'
    }
  } finally {
    streamAbort = null
  }
}

function applyMeta(m) {
  const d = draft.value
  if (!d) return
  if (!d._userName) {
    d.name = m.title || 'Untitled score'
    nameDraft.value = d.name
  }
  d.data.key = m.key
  d.data.bpm = m.bpm
  d.data.timeSig = m.timeSig
  d.data.contentTop = m.contentTop
  d.data.contentBottom = m.contentBottom
  d.expectedLines = m.expectedLines
  bpm.value = m.bpm
}

function pushDraftLine(line) {
  const d = draft.value
  if (!d) return
  d.data.lines.push(line)
  streamProgress.value = { ...streamProgress.value, lines: d.data.lines.length }
}

async function continueDraft() {
  const d = draft.value
  if (!d || d.streaming) return
  d.streaming = true
  d.truncated = false
  d.error = ''
  beginTrace()
  streamAbort = new AbortController()
  try {
    const result = await continueTranscription(d._dataUri, { data: d.data }, {
      model: d._model,
      effort: d._effort,
      mode: d._mode || 'jianpu',
      expression: !!d._expression,
      notes: d._notes || '',
      signal: streamAbort.signal,
      onLine: pushDraftLine,
      onProgress: () => { streamProgress.value = { ...streamProgress.value, lines: d.data.lines.length } },
      onReasoning: () => { streamProgress.value = { ...streamProgress.value, reasoning: true } },
      onTrace: pushTrace,
    })
    if (!draft.value) return
    d.streaming = false
    if (result.truncated) {
      d.truncated = true
      showToast('Still incomplete — you can continue again')
    } else {
      await persistDraft()
    }
  } catch (e) {
    if (e?.name === 'AbortError') return
    console.error('[Bawu] continue failed:', e)
    if (draft.value) {
      draft.value.streaming = false
      draft.value.error = e.message || 'Continue failed.'
    }
  } finally {
    streamAbort = null
  }
}

async function persistDraft() {
  const d = draft.value
  if (!d) return
  if (!d.data.lines.length) {
    discardDraft()
    showToast('No notes were transcribed')
    return
  }
  try {
    const cleanData = JSON.parse(JSON.stringify({
      key: d.data.key, bpm: d.data.bpm, timeSig: d.data.timeSig,
      contentTop: d.data.contentTop ?? null, contentBottom: d.data.contentBottom ?? null,
      lines: d.data.lines,
    }))
    const saved = await store.createScore({
      name: d.name || 'Untitled score',
      folderId: d._folderId,
      source: 'image',
      data: cleanData,
      imageBlob: d._blob,
      aiMeta: d._meta,
    })
    const savedId = saved?.id
    const savedName = saved?.name || d.name
    clearDraft()
    if (savedId) store.selectScore(savedId)
    showToast(`Saved “${savedName}”`)
  } catch (e) {
    console.error('[Bawu] persist draft failed:', e)
    if (draft.value) draft.value.error = e.message || 'Could not save the score.'
    showToast(e.message || 'Could not save the score')
  }
}

function keepDraft() {
  persistDraft()
}

function abortStream() {
  if (streamAbort) {
    try { streamAbort.abort() } catch { /* already gone */ }
    streamAbort = null
  }
}

function clearDraft() {
  if (draft.value?.previewUrl) URL.revokeObjectURL(draft.value.previewUrl)
  draft.value = null
  imageUrl.value = ''
}

function discardDraft() {
  abortStream()
  clearDraft()
}

// ── Rail folders ────────────────────────────────────────────────────────────
function folderScores(folderId) {
  return matchedScores.value.filter((s) => s.folder_id === folderId)
}
function isExpanded(id) {
  return railQuery.value.trim() ? true : expanded.value.has(id)
}
function toggleFolder(id) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}
function startAddFolder() {
  addingFolder.value = true
  newFolderName.value = ''
  nextTick(() => newFolderInput.value?.focus())
}
async function confirmAddFolder() {
  const name = newFolderName.value.trim()
  addingFolder.value = false
  if (!name) return
  const f = await store.createFolder(name)
  if (f) expanded.value = new Set([...expanded.value, f.id])
}
function cancelAddFolder() {
  addingFolder.value = false
  newFolderName.value = ''
}
function startRenameFolder(f) {
  editingFolderId.value = f.id
  editFolderName.value = f.name
}
function confirmRenameFolder(f) {
  const name = editFolderName.value.trim()
  editingFolderId.value = null
  if (name && name !== f.name) store.renameFolder(f.id, name)
}
function cancelRenameFolder() {
  editingFolderId.value = null
}
function removeFolder(f) {
  if (!confirm(`Delete folder “${f.name}”? Its scores stay, ungrouped.`)) return
  store.deleteFolder(f.id)
}
function focusRenameInput(el) {
  if (el) el.focus()
}

// Row menu
const menuScore = computed(() => store.scores.find((s) => s.id === rowMenu.value.scoreId) || null)
function openRowMenu(ev, s) {
  const pad = 8
  const x = Math.min(ev.clientX, window.innerWidth - 230)
  const y = Math.min(ev.clientY, window.innerHeight - 320)
  rowMenu.value = { open: true, x: x + pad, y: y + pad, scoreId: s.id }
}
function closeRowMenu() {
  rowMenu.value.open = false
}
function renameFromMenu() {
  const s = menuScore.value
  closeRowMenu()
  if (!s) return
  const name = prompt('Rename score', s.name)
  if (name && name.trim()) store.renameScore(s.id, name.trim())
}
function moveTo(folderId) {
  const s = menuScore.value
  closeRowMenu()
  if (!s) return
  store.moveScoreToFolder(s.id, folderId)
  if (folderId) expanded.value = new Set([...expanded.value, folderId])
}
function deleteFromMenu() {
  const s = menuScore.value
  closeRowMenu()
  if (!s) return
  if (!confirm(`Delete “${s.name}”? The original picture is removed too.`)) return
  store.deleteScore(s.id)
}

// Phone-landscape "Exit": leave the roll and go back to the app.
function exitFullscreen() {
  router.push('/')
}

// ── Misc ────────────────────────────────────────────────────────────────────
let toastTimer = 0
function showToast(msg) {
  toastMsg.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastMsg.value = ''), 2400)
}

const posLabel = computed(() => {
  const n = playableNotes.value.length
  return n ? `${Math.min(uiIdx.value + 1, n)} / ${n}` : '—'
})

// Load signed image URL + reset playback when the active score changes.
watch(
  () => score.value?.id,
  async () => {
    playing.value = false
    variant.value = 'original'
    selectedIds.value = new Set()
    undoStack.value = []
    clipboard.value = null
    picZoom.value = 1
    liveEdit.value = null
    resetPlayback(0)
    nameDraft.value = score.value?.name || ''
    bpm.value = scoreBpm.value
    scoreView.value = hasPicture.value ? 'picture' : 'jianpu'
    if (isDraft.value) {
      imageUrl.value = draft.value.previewUrl
      return
    }
    // Backfill the imported-key marker for scores created before it existed, so
    // "orig" locks to the current key instead of drifting when keys are clicked.
    if (score.value?.data && !score.value.data.origKey) {
      store.updateScoreData(score.value.id, { ...score.value.data, origKey: canonicalKey(score.value.data.key) || 'F' })
    }
    imageUrl.value = ''
    const path = score.value?.image_path
    if (path) {
      try {
        imageUrl.value = await store.getImageUrl(path)
      } catch {
        imageUrl.value = ''
      }
    }
  },
  { immediate: true },
)

watch(keyName, () => resetPlayback(curIdx))
watch(variant, () => resetPlayback(0))

// Tick while a run is in flight so the elapsed / "quiet for Ns" readouts keep
// counting even when no data is arriving — which is precisely when they matter.
let traceTimer = 0
watch(
  () => streaming.value || lyricsRunning.value,
  (on) => {
    clearInterval(traceTimer)
    if (on) traceTimer = setInterval(() => traceClock.value++, 500)
  },
  { immediate: true },
)

// Keep the where-are-we band visible as the piece walks down the picture.
watch(
  () => currentNote.value?.lineIdx,
  (li) => {
    const wrap = pageImgWrap.value
    const b = lineBandFrac.value
    if (li == null || !wrap || !b) return
    const center = (b.top + b.bottom) / 2
    wrap.scrollTo({ top: center * wrap.scrollHeight - wrap.clientHeight / 2, behavior: 'smooth' })
  },
)

watch(
  () => score.value?.name,
  (n) => {
    if (n != null) nameDraft.value = n
  },
)

// Phone portrait: keep the line being played inside the reader's window.
watch(
  () => currentNote.value?.lineIdx,
  (li) => {
    if (li == null || layout.value !== 'phone-portrait') return
    nextTick(() => {
      const wrap = ppSheetEl.value
      const line = wrap?.querySelectorAll('.a4-line')?.[li]
      if (!wrap || !line) return
      const wrapBox = wrap.getBoundingClientRect()
      const lineBox = line.getBoundingClientRect()
      const top = wrap.scrollTop + (lineBox.top - wrapBox.top) - wrap.clientHeight / 2 + lineBox.height / 2
      wrap.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    })
  },
)

// ── Keyboard ────────────────────────────────────────────────────────────────
function onKeydown(e) {
  const tag = e.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !score.value) return

  if (editMode.value) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); copySelection(); return }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); pasteSelection(); return }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return }
    if (/^[1-7]$/.test(e.key)) { e.preventDefault(); stepInsert(Number(e.key)); return }
    if (e.code === 'ArrowUp') { e.preventDefault(); shiftSelRow(-1); return }
    if (e.code === 'ArrowDown') { e.preventDefault(); shiftSelRow(1); return }
    if (e.code === 'ArrowLeft') { e.preventDefault(); setSelLengthDelta(-0.25); return }
    if (e.code === 'ArrowRight') { e.preventDefault(); setSelLengthDelta(0.25); return }
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); deleteSelection(); return }
    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); togglePlay(); return }
    if (e.code === 'Escape') { exitEdit(); return }
    return
  }

  if (e.code === 'Space' && !e.repeat) {
    e.preventDefault()
    if (mode.value === 'follow' && playing.value) {
      const cur = playableNotes.value[curIdx]
      if (cur?.midi != null) playBawuTone(cur.midi, 0.4)
      advanceFollow()
    } else {
      togglePlay()
    }
  } else if (e.code === 'Home') {
    e.preventDefault()
    goToStart()
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault()
    stepBy(-1)
  } else if (e.code === 'ArrowRight') {
    e.preventDefault()
    stepBy(1)
  } else if (e.code === 'Escape') {
    stopAll()
  }
}

function onDocClick() {
  takesOpen.value = false
}

function onResize() {
  vw.value = viewportW()
  vh.value = viewportH()
  if (window.matchMedia) coarsePointer.value = window.matchMedia('(pointer: coarse)').matches
}

onMounted(() => {
  store.fetchScores()
  if (!store.activeScoreId && store.scores.length) store.selectScore(store.scores[0].id)
  lastTs = performance.now()
  rafId = requestAnimationFrame(frame)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
  window.addEventListener('orientationchange', onResize)
  document.addEventListener('click', onDocClick)
  onResize()
})

watch(
  () => store.loaded,
  (loaded) => {
    if (loaded && !store.activeScoreId && store.scores.length) store.selectScore(store.scores[0].id)
  },
)

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  clearInterval(traceTimer)
  releaseVoice(0.02)
  tracker.stop()
  if (recording.value) recorder.stop()
  for (const take of takes.value) URL.revokeObjectURL(take.url)
  discardDraft()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('orientationchange', onResize)
  window.removeEventListener('pointerup', onAxisPointerUp)
  window.removeEventListener('pointercancel', onAxisPointerUp)
  window.removeEventListener('pointermove', onColResizeMove)
  window.removeEventListener('pointerup', onColResizeUp)
  document.removeEventListener('click', onDocClick)
  clearTimeout(toastTimer)
})
</script>

<style scoped>
.bawu-app {
  --accent-500: #ef4444;
  --accent-600: #b91c1c;
  --accent-400: #f87171;
  --accent-100: #fee2e2;
  --accent-050: #fef2f2;

  --bg-card:     #ffffff;
  --bg-sunken:   #f3f2f0;
  --border:      #e5e4e1;
  --border-soft: #eeede9;
  --text:        #1a1a1a;
  --text-dim:    #5c5c5c;
  --text-faint:  #9a9a9a;

  --ok: #16a34a;
  --ok-soft: #dcfce7;
  --ok-ink: #166534;
  --warn: #d97706;
  --warn-soft: #fffbeb;

  --radius:    0.75rem;
  --radius-lg: 1rem;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02);
  --shadow:    0 2px 8px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04);
  --shadow-lg: 0 8px 30px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);

  --mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;

  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif;
  color: var(--text);
  font-size: 0.9375rem;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  height: calc(100vh - 6.75rem);
  height: calc(100dvh - 6.75rem); /* dvh: phone chrome shrinks the viewport */
  overflow: hidden;
  display: flex;
  align-items: stretch;
  position: relative;
  background: var(--bg-sunken);
}
/* Phone landscape is a full-screen practice surface: it covers the app navbar
   (which is far too tall for a 400px-high viewport and overflows sideways). */
.bawu-app.layout-phone-landscape {
  position: fixed;
  inset: 0;
  z-index: 900;
  width: 100vw;
  width: 100dvw;
  height: 100vh;
  height: 100dvh;
  overscroll-behavior: none;
}
:where(.bawu-app button) { font: inherit; color: inherit; cursor: pointer; background: none; border: none; padding: 0; }
.bawu-app button:disabled { opacity: 0.4; cursor: not-allowed; }
.bawu-app input, .bawu-app select { font: inherit; color: inherit; }

/* ── Floating rail controls ── */
.bawu-app .rail-fab {
  position: absolute; left: 0.85rem; z-index: 25;
  width: 2.5rem; height: 2.5rem; border-radius: 0.75rem;
  display: grid; place-items: center; font-size: 0.95rem;
  border: 1px solid var(--border); background: var(--bg-card); color: var(--text-dim);
  box-shadow: var(--shadow); transition: background 120ms, color 120ms, border-color 120ms;
}
.bawu-app .rail-fab:hover { border-color: var(--accent-400); color: var(--accent-600); }
.rail-fab-top { top: 0.85rem; }
.rail-fab-tuner { bottom: 1rem; }
.bawu-app .rail-fab-tuner.on { background: var(--accent-050); border-color: var(--accent-400); color: var(--accent-600); }

/* ── Rail ── in flow, so opening it pushes the stage across instead of covering it */
.rail-overlay {
  position: relative; z-index: 31;
  flex: 0 0 18.75rem; width: 18.75rem; margin-left: -18.75rem;
  background: var(--bg-card); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem 0.75rem;
  opacity: 0; visibility: hidden; will-change: margin-left;
  transition: margin-left 200ms ease, opacity 140ms ease, visibility 0s linear 200ms;
}
.rail-overlay.open {
  margin-left: 0; opacity: 1; visibility: visible;
  transition: margin-left 200ms ease, opacity 140ms ease, visibility 0s;
}

.rail-head { display: flex; justify-content: space-between; align-items: flex-start; }
.eyebrow { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.09em; color: var(--accent-500); }
.rail-title-row { display: flex; align-items: baseline; gap: 0.5rem; }
.rail-title { font-size: 1.25rem; font-weight: 800; margin: 0.1rem 0 0; letter-spacing: -0.01em; }
.rail-sub { font-size: 0.75rem; color: var(--text-faint); }

.rail-actions { display: flex; gap: 0.4rem; align-items: stretch; }
.bawu-app .add-btn.rail-new { width: auto; flex: 1; height: 2.4rem; padding: 0 1rem; border-radius: 0.6rem; font-weight: 600; font-size: 0.85rem; }
.bawu-app .rail-actions .rail-newfolder {
  width: 2.4rem; height: 2.4rem; border-radius: 0.6rem;
  border: 1px solid var(--border); background: var(--bg-card); color: var(--text-dim);
}
.bawu-app .rail-actions .rail-newfolder:hover { background: var(--accent-050); border-color: var(--accent-400); color: var(--accent-600); }

.rail-search {
  display: flex; align-items: center; gap: 0.45rem;
  border: 1px solid var(--border); border-radius: 0.6rem;
  padding: 0 0.6rem; background: var(--bg-sunken);
  transition: border-color 120ms, background 120ms;
}
.rail-search:focus-within { border-color: var(--accent-500); background: #fff; box-shadow: 0 0 0 3px var(--accent-050); }
.rail-search .pi-search { font-size: 0.8rem; color: var(--text-faint); }
.rail-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; padding: 0.45rem 0; font-size: 0.85rem; color: var(--text); }
.rail-search input::placeholder { color: var(--text-faint); }
.rail-search-clear { color: var(--text-faint); padding: 0.15rem; font-size: 0.72rem; display: inline-flex; }
.rail-search-clear:hover { color: var(--text-dim); }

.rail-selection-bar {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.45rem 0.6rem; margin-top: 0.6rem;
  border: 1px solid var(--accent-500); border-radius: 0.6rem;
  background: var(--accent-050);
}
.rail-selection-count { flex: none; font-size: 0.8rem; font-weight: 600; color: var(--accent-600); white-space: nowrap; }
.rail-selection-clear {
  margin-left: auto; flex: none; padding: 0.3rem 0.55rem; border-radius: 0.45rem;
  color: var(--text-dim); font-weight: 600; font-size: 0.75rem; white-space: nowrap;
}
.rail-selection-clear:hover { background: #fff; color: var(--text); }
.rail-selection-delete {
  flex: none; display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap;
  padding: 0.3rem 0.6rem; border-radius: 0.45rem;
  background: var(--accent-600); color: #fff; font-weight: 700; font-size: 0.75rem;
}
.rail-selection-delete:hover { background: var(--accent-700, #991b1b); }

.rail-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 0.4rem; min-height: 4rem; padding: 0.15rem 0.15rem 0.4rem; }
.bawu-app .rail-item {
  position: relative; display: flex; align-items: flex-start; gap: 0.6rem;
  width: 100%; text-align: left; padding: 0.6rem 0.65rem; border-radius: 0.65rem;
  background: var(--bg-card); border: 1px solid var(--border);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  transition: border-color 120ms, box-shadow 120ms, background 120ms;
}
.bawu-app .rail-item:hover { border-color: var(--accent-400); box-shadow: 0 2px 7px rgba(0, 0, 0, 0.07); }
.bawu-app .rail-item.active { background: var(--accent-050); border-color: var(--accent-500); box-shadow: 0 1px 3px rgba(239, 68, 68, 0.18); }
.bawu-app .rail-item.multi-selected { background: var(--bg-sunken); border-color: var(--text-dim); }
.bawu-app .rail-item.multi-selected.active { background: var(--accent-050); border-color: var(--accent-500); box-shadow: 0 0 0 2px var(--text-dim) inset; }
.rail-item-icon { flex: none; width: 1.75rem; height: 1.75rem; border-radius: 0.5rem; display: inline-flex; align-items: center; justify-content: center; background: var(--bg-sunken); color: var(--text-dim); font-size: 0.85rem; }
.rail-item.active .rail-item-icon { background: #fff; color: var(--accent-600); }
.rail-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.rail-item-name { font-weight: 700; font-size: 0.875rem; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail-item.active .rail-item-name { color: var(--accent-600); }
.rail-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem; }
.rail-meta .stat { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.7rem; color: var(--text-dim); }
.rail-meta .stat-time { margin-left: auto; color: var(--text-faint); }

.rail-state { display: flex; flex-direction: column; align-items: center; gap: 0.45rem; padding: 1.75rem 0.5rem; color: var(--text-faint); font-size: 0.85rem; text-align: center; }
.rail-state-icon { font-size: 1.5rem; opacity: 0.55; }

.folder-add { display: flex; align-items: center; gap: 0.45rem; padding: 0.5rem 0.6rem; border: 1px dashed var(--accent-400); border-radius: 0.6rem; background: var(--accent-050); }
.folder-add .folder-icon { color: var(--accent-600); font-size: 0.85rem; }
.folder-add input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font-size: 0.85rem; font-weight: 600; color: var(--text); }
.folder { display: flex; flex-direction: column; }
.folder-head { display: flex; align-items: center; gap: 0.4rem; padding: 0.4rem; border-radius: 0.5rem; cursor: pointer; user-select: none; transition: background 120ms; }
.folder-head:hover { background: var(--bg-sunken); }
.folder-chevron { font-size: 0.7rem; color: var(--text-faint); width: 0.8rem; text-align: center; }
.folder-head .folder-icon { font-size: 0.85rem; color: var(--accent-600); }
.folder-name { flex: 1; min-width: 0; font-size: 0.82rem; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder-rename { flex: 1; min-width: 0; border: 1px solid var(--accent-400); border-radius: 0.4rem; padding: 0.15rem 0.4rem; font-size: 0.82rem; font-weight: 700; outline: none; background: #fff; color: var(--text); }
.folder-count { font-size: 0.68rem; font-weight: 700; color: var(--text-faint); background: var(--bg-sunken); border-radius: 999px; padding: 0.05rem 0.4rem; min-width: 1.1rem; text-align: center; }
.folder-tools { display: none; align-items: center; gap: 0.1rem; }
.folder-head:hover .folder-tools { display: flex; }
.bawu-app .folder-tool { width: 1.5rem; height: 1.5rem; border-radius: 0.35rem; display: inline-flex; align-items: center; justify-content: center; color: var(--text-faint); font-size: 0.7rem; }
.bawu-app .folder-tool:hover { background: #fff; color: var(--accent-600); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
.bawu-app .folder-tool:last-child:hover { color: #c33; }
.folder-body { display: flex; flex-direction: column; gap: 0.35rem; padding: 0.35rem 0 0.2rem 0.55rem; margin: 0.1rem 0 0.15rem 0.45rem; border-left: 1px solid var(--border-soft); }
.folder-empty { font-size: 0.74rem; color: var(--text-faint); padding: 0.2rem 0.4rem; font-style: italic; }
.folder-loose { display: flex; flex-direction: column; gap: 0.4rem; }
.loose-label { font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-faint); padding: 0.5rem 0.4rem 0.05rem; }
.rail-item-kebab { flex: none; align-self: center; width: 1.4rem; height: 1.4rem; display: inline-flex; align-items: center; justify-content: center; border-radius: 0.35rem; color: var(--text-faint); font-size: 0.8rem; opacity: 0; transition: opacity 120ms, background 120ms, color 120ms; }
.rail-item:hover .rail-item-kebab, .rail-item.active .rail-item-kebab { opacity: 1; }
.rail-item-kebab:hover { background: #fff; color: var(--accent-600); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }

.sq-menu-backdrop { position: fixed; inset: 0; z-index: 120; }
.sq-menu { position: fixed; z-index: 121; width: 13.5rem; max-height: 60vh; overflow-y: auto; background: #fff; border: 1px solid var(--border); border-radius: 0.6rem; box-shadow: var(--shadow-lg); padding: 0.3rem; }

.rail-newsheet-wrap { position: relative; }
.rail-newsheet-menu { position: absolute; top: calc(100% + 0.35rem); left: 0; z-index: 121; width: 9rem; background: #fff; border: 1px solid var(--border); border-radius: 0.6rem; box-shadow: var(--shadow-lg); padding: 0.3rem; }
.sq-menu-label { font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-faint); padding: 0.3rem 0.5rem 0.2rem; }
.bawu-app .sq-menu-item { display: flex; align-items: center; gap: 0.5rem; width: 100%; text-align: left; padding: 0.4rem 0.5rem; border-radius: 0.4rem; font-size: 0.83rem; color: var(--text); }
.bawu-app .sq-menu-item i { font-size: 0.78rem; color: var(--text-faint); width: 0.9rem; }
.bawu-app .sq-menu-item:hover { background: var(--accent-050); }
.bawu-app .sq-menu-item.on { color: var(--accent-600); font-weight: 600; }
.bawu-app .sq-menu-item.on i { color: var(--accent-600); }
.bawu-app .sq-menu-item.danger { color: #c33; }
.bawu-app .sq-menu-item.danger i { color: #c33; }
.bawu-app .sq-menu-item.danger:hover { background: #fff0f0; }
.sq-menu-hint { font-size: 0.72rem; color: var(--text-faint); padding: 0.2rem 0.5rem 0.4rem; line-height: 1.35; }
.sq-menu-sep { height: 1px; background: var(--border-soft); margin: 0.3rem 0.2rem; }
/* ── Stage ── */
.stage { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 0.75rem 1rem 0.75rem; gap: 0.65rem; min-height: 0; position: relative; }

.stage-header { display: flex; align-items: center; gap: 0.9rem; padding-left: 2.85rem; transition: padding-left 200ms ease; }
.rail-open .stage-header { padding-left: 0; } /* the open-rail button is gone — reclaim the gap */
.header-title { min-width: 0; flex: 1; }
.score-name { font-size: 1.2rem; font-weight: 800; letter-spacing: -0.02em; border: none; outline: none; background: none; width: 100%; padding: 0.05rem 0; border-bottom: 2px solid transparent; }
.score-name:focus { border-bottom-color: var(--accent-400); }
.header-meta { display: flex; align-items: center; gap: 0.3rem; margin-top: 0.1rem; font-size: 0.72rem; color: var(--text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.header-meta .hm-key { font-weight: 700; color: var(--accent-600); }
.header-meta .hm-model { display: inline-flex; align-items: center; gap: 0.25rem; cursor: default; }
.header-meta .hm-model i { font-size: 0.55rem; }
.header-meta .hm-saving { display: inline-flex; align-items: center; gap: 0.25rem; margin-left: 0.4rem; }

.mode-pill { display: inline-flex; align-items: center; background: var(--bg-card); border: 1px solid var(--border); border-radius: 999px; padding: 0.25rem; gap: 0.15rem; box-shadow: 0 2px 10px rgba(0,0,0,0.06); flex-shrink: 0; }
.bawu-app .mode-pill .ms { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.45rem 0.9rem; border-radius: 999px; font-size: 0.8rem; font-weight: 700; color: var(--text-dim); white-space: nowrap; transition: background 120ms, color 120ms; }
.bawu-app .mode-pill .ms i { font-size: 0.72rem; }
.bawu-app .mode-pill .ms:hover { color: var(--text); }
.bawu-app .mode-pill .ms.on { background: var(--accent-050); color: var(--accent-600); box-shadow: 0 1px 3px rgba(239,68,68,0.12); }
.bawu-app .mode-pill .ms-edit.on { background: var(--accent-500); color: #fff; }
.mode-pill .ms-div { width: 1px; height: 1.35rem; background: var(--border); margin: 0 0.2rem; }

.header-right { flex: 1; display: flex; align-items: center; justify-content: flex-end; gap: 0.45rem; }
.bawu-app .btn-convert { display: inline-flex; align-items: center; gap: 0.35rem; height: 2rem; padding: 0 0.7rem; border-radius: 0.55rem; font-size: 0.78rem; font-weight: 600; color: var(--accent-600); border: 1px solid var(--accent-100); background: var(--accent-050); white-space: nowrap; }
.bawu-app .btn-convert:hover { background: var(--accent-100); }

/* Streaming strip */
.stream-strip { display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap; padding: 0.5rem 0.75rem; border-radius: 0.7rem; flex-shrink: 0; border: 1px solid var(--accent-100); background: var(--accent-050); color: var(--accent-600); }
.stream-strip.warn { border-color: #fde68a; background: var(--warn-soft); color: var(--warn); }
.stream-strip > i { font-size: 0.85rem; flex-shrink: 0; }
.stream-strip .ss-text { font-size: 0.82rem; color: var(--text-dim); }
.stream-strip .ss-text b { color: var(--text); font-weight: 700; font-variant-numeric: tabular-nums; }
.stream-strip .ss-bar { flex: 1; min-width: 6rem; max-width: 16rem; height: 0.35rem; border-radius: 999px; background: #fff; overflow: hidden; border: 1px solid var(--accent-100); }
.stream-strip .ss-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--accent-400), var(--accent-600)); transition: width 240ms ease; }
.stream-strip .ss-fill.indet { width: 35%; animation: bawu-indet 1.3s ease-in-out infinite; }
@keyframes bawu-indet { 0% { margin-left: -35%; } 100% { margin-left: 100%; } }
.stream-strip .ss-hint { font-size: 0.72rem; color: var(--text-faint); margin-left: auto; font-variant-numeric: tabular-nums; }
.stream-strip .ss-hint.stalled { color: var(--warn); font-weight: 700; }
.stream-strip.warn .ss-text { color: var(--text-dim); }

/* ── Player ── */
.player { flex: 1; min-height: 0; display: flex; gap: 0.75rem; }
/* Sunken, because the deck inside it is a capped, centred sheet — the surround
   has to read as desk rather than as a panel that failed to fill. */
.desk { flex: 1; min-width: 0; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 0.875rem; overflow: hidden; background: var(--bg-sunken); min-height: 0; box-shadow: var(--shadow); }

/* Practice toolbar */
.desk-bar { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.45rem 0.7rem; border-bottom: 1px solid var(--border-soft); background: var(--bg-card); flex-shrink: 0; }
.desk-bar .tb-div { width: 1px; height: 1.25rem; background: var(--border-soft); }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--bg-sunken); padding: 0.12rem; gap: 0.1rem; }
.bawu-app .seg button { min-width: 1.85rem; height: 1.55rem; padding: 0 0.5rem; border-radius: 0.35rem; font-weight: 700; font-size: 0.78rem; color: var(--text-dim); display: inline-flex; align-items: center; justify-content: center; }
.bawu-app .seg button.on { background: #fff; color: var(--accent-600); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.seg-zoom button i { font-size: 0.6rem; }
.bawu-app .seg-zoom .zoom-val { min-width: 2.6rem; font-family: var(--mono); font-size: 0.7rem; color: var(--text-dim); }
.bawu-app .chip { display: inline-flex; align-items: center; gap: 0.35rem; height: 1.85rem; padding: 0 0.7rem; border-radius: 999px; border: 1px solid var(--border); background: #fff; font-size: 0.78rem; font-weight: 600; color: var(--text-dim); white-space: nowrap; flex-shrink: 0; transition: border-color 120ms, color 120ms, background 120ms; }
.bawu-app .chip.chip-sm { height: 1.65rem; padding: 0 0.6rem; font-size: 0.75rem; }
.bawu-app .chip:hover { color: var(--text); border-color: var(--text-faint); }
.bawu-app .chip.live { background: var(--accent-050); border-color: transparent; color: var(--accent-600); box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.25); }
.bawu-app .chip.chip-ai { border-color: var(--accent-100); color: var(--accent-600); }
.bawu-app .chip.chip-ai:hover { background: var(--accent-050); border-color: var(--accent-400); }
.desk-bar .mode-hint { font-size: 0.75rem; color: var(--text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.desk-bar .spacer, .inspector .spacer, .key-card .spacer { flex: 1; }

/* Edit toolbar (red) */
.edit-bar { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.45rem 0.7rem; background: var(--accent-050); border-bottom: 2px solid var(--accent-500); flex-shrink: 0; }
.bawu-app .eb-icon { width: 1.9rem; height: 1.9rem; border-radius: 0.5rem; border: 1px solid var(--accent-100); background: #fff; color: var(--accent-600); display: inline-flex; align-items: center; justify-content: center; }
.bawu-app .eb-icon:hover:not(:disabled) { background: var(--accent-050); }
.bawu-app .eb-icon.on { background: var(--accent-500); border-color: var(--accent-500); color: #fff; }
.edit-bar .eb-div { width: 1px; height: 1.25rem; background: var(--accent-100); }
.bawu-app .eb-btn { display: inline-flex; align-items: center; gap: 0.35rem; height: 1.9rem; padding: 0 0.65rem; border-radius: 0.5rem; border: 1px solid var(--accent-100); background: #fff; color: var(--accent-600); font-size: 0.75rem; font-weight: 600; }
.bawu-app .eb-btn:hover:not(:disabled) { background: var(--accent-050); }
.bawu-app .eb-selchip { display: inline-flex; align-items: center; gap: 0.4rem; height: 1.9rem; padding: 0 0.65rem; border-radius: 999px; background: #fff; border: 1px solid var(--accent-500); color: var(--accent-600); font-size: 0.75rem; font-weight: 700; }
.eb-hint { font-size: 0.72rem; color: var(--accent-600); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kbd { font-family: var(--mono); font-weight: 600; font-size: 0.85em; }

/* ── Phone-landscape roll ──
   The desktop deck (BawuFluteRoll) carries its own styles; what follows is the
   horizontal roll, which only the phone in landscape still uses — a short, wide
   screen reads a scrolling pitch axis far better than a standing one. */
.lane { position: absolute; top: 0; bottom: 0; left: 0; will-change: transform; }
.barline { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--border-soft); }

.note { position: absolute; border-radius: 999px; display: flex; align-items: center; justify-content: center; gap: 0.4rem; padding: 0 0.8rem; font-size: clamp(0.9rem, 2.2vh, 1.15rem); font-weight: 700; transform: translateY(-50%); height: clamp(1.9rem, 6vh, 2.6rem); user-select: none; cursor: pointer; white-space: nowrap; z-index: 1; }
.note-lab { flex: none; }
.note.upcoming { background: #fff; border: 1.5px solid #d6d4d0; color: #44403c; }
.note.done { background: #bbf7d0; border: 1px solid #86efac; color: var(--ok-ink); }
.note.current { background: var(--accent-500); border: none; color: #fff; box-shadow: 0 3px 12px rgba(239, 68, 68, 0.4); z-index: 3; }
.note.unplayable { border-style: dashed; border-color: var(--warn); color: var(--warn); background: var(--warn-soft); }
/* A tie's two halves are one sound, so they butt together into a continuous
   pill: flat facing edges, and a dimmed label on the tail so it doesn't read as
   a fresh attack. Slurred notes stay separate pills joined by an arc. */
.bawu-app .note.tied-in { border-top-left-radius: 0.25rem; border-bottom-left-radius: 0.25rem; padding-left: 0.45rem; }
.bawu-app .note.ties-out { border-top-right-radius: 0.25rem; border-bottom-right-radius: 0.25rem; padding-right: 0.45rem; }
.bawu-app .note.tied-in .note-lab { opacity: 0.55; font-weight: 600; }
/* Short notes: a squarer, tighter pill so the length stays honest — the label
   keeps its full size, the padding is what gives way. */
.bawu-app .note.tight { padding: 0 0.25rem; gap: 0.2rem; border-radius: 0.5rem; }
.bawu-app .note.tiny { padding: 0; border-radius: 0.3rem; font-size: clamp(0.65rem, 1.6vh, 0.8rem); }
.bawu-app .note.tiny .note-lab { display: none; }

/* The playhead lives in one zero-width group the rAF loop translates: parked
   near the left edge while the sheet scrolls, sweeping across it in line mode.
   Children are positioned relative to the line, not to the roll. */
.now-group { position: absolute; top: 0; bottom: 0; left: 0; width: 0; z-index: 6; pointer-events: none; will-change: transform; }
.nowline { position: absolute; top: 0; bottom: 0; left: 0; width: 2px; background: var(--accent-500); box-shadow: 0 0 14px rgba(239, 68, 68, 0.45); }

/* Expression overlay: ties, slurs, slides, bends, vibrato. */
.lane-fx { position: absolute; top: 0; left: 0; overflow: visible; pointer-events: none; z-index: 2; }
.lane-fx path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.lane-fx .fx-tie { stroke: #44403c; stroke-width: 1.6; }
.lane-fx .fx-slur { stroke: #78716c; stroke-width: 1.4; }
.lane-fx .fx-gliss { stroke: var(--warn); stroke-width: 1.8; }
.lane-fx .fx-bend, .lane-fx .fx-vib { stroke: var(--warn); stroke-width: 1.4; }

/* Karaoke band */
.band { display: flex; align-items: center; gap: 1.25rem; padding: 0.9rem 1.5rem; border-top: 1px solid var(--border-soft); background: #1a1a1a; flex-shrink: 0; }
.band-label { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #8a8a8a; flex-shrink: 0; }
.band-window { flex: 1; display: flex; align-items: baseline; justify-content: center; gap: 1.5rem; overflow: hidden; }
.band-syl { display: inline-flex; flex-direction: column; align-items: center; gap: 0.15rem; flex-shrink: 0; transition: opacity 160ms; }
.band-syl .bs-main { font-size: 1.15rem; font-weight: 600; color: #d4d4d4; line-height: 1.15; }
.band-syl .bs-sub { font-size: 0.8rem; color: #8a8a8a; font-weight: 500; }
.band-syl.cur .bs-main { font-size: 1.6rem; font-weight: 800; color: #fff; }
.band-syl.cur .bs-sub { color: var(--accent-400); }
.band-loc { font-size: 0.72rem; font-weight: 700; color: var(--accent-400); flex-shrink: 0; }

/* Inspector (edit) */
.inspector { display: flex; align-items: center; gap: 0.55rem; padding: 0.55rem 0.7rem; border-top: 1px solid var(--border); background: #fcfcfb; overflow-x: auto; flex-shrink: 0; }
.insp-sel { font-size: 0.78rem; font-weight: 700; white-space: nowrap; }
.insp-div { width: 1px; height: 1.35rem; background: var(--border); flex-shrink: 0; }
.insp-lbl { font-size: 0.72rem; color: var(--text-dim); white-space: nowrap; }
.seg-deg button { width: 1.5rem; }
.row-step { display: inline-flex; gap: 0.2rem; flex-shrink: 0; }
.bawu-app .row-step button { width: 1.5rem; height: 1.5rem; border-radius: 0.4rem; border: 1px solid var(--border); background: #fff; color: var(--text-dim); font-size: 0.65rem; display: inline-flex; align-items: center; justify-content: center; }
.bawu-app .row-step button:hover:not(:disabled) { border-color: var(--accent-400); color: var(--accent-600); }
.row-step .row-val { min-width: 2.4rem; height: 1.5rem; border-radius: 0.4rem; border: 1px solid var(--border); background: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 700; }
.insp-ly { width: 3.75rem; height: 1.65rem; border: 1px solid var(--border); border-radius: 0.4rem; background: #fff; padding: 0 0.5rem; font-size: 0.78rem; outline: none; }
.insp-ly:focus { border-color: var(--accent-500); }
.bawu-app .insp-del { display: inline-flex; align-items: center; gap: 0.35rem; height: 1.75rem; padding: 0 0.65rem; border-radius: 0.5rem; border: 1px solid var(--accent-100); background: #fff; color: #c33; font-size: 0.75rem; font-weight: 600; flex-shrink: 0; }
.bawu-app .insp-del:hover:not(:disabled) { background: #fff0f0; }

/* Second inspector row: ties, slurs, slides, bends, vibrato. */
.inspector.insp-fx { border-top: 1px dashed var(--border); background: #fffdfb; }
.bawu-app .fx-btn {
  display: inline-flex; align-items: center; gap: 0.3rem; height: 1.65rem; padding: 0 0.55rem;
  border-radius: 0.45rem; border: 1px solid var(--border); background: #fff;
  font-size: 0.75rem; font-weight: 600; color: var(--text-dim); white-space: nowrap; flex-shrink: 0;
  transition: border-color 120ms, color 120ms, background 120ms;
}
.bawu-app .fx-btn:hover:not(:disabled) { border-color: var(--accent-400); color: var(--accent-600); background: var(--accent-050); }
.bawu-app .fx-btn.on { border-color: var(--accent-500); background: var(--accent-050); color: var(--accent-600); }
.bawu-app .fx-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.seg-vb button { min-width: 1.6rem; font-size: 0.75rem; }
/* ── Roll ↔ panel divider ── */
.col-divider { flex-shrink: 0; align-self: stretch; width: 0.6rem; margin: 0 -0.15rem; cursor: col-resize; display: flex; align-items: center; justify-content: center; touch-action: none; }
.col-divider .cd-grip { width: 3px; height: 2.75rem; border-radius: 3px; background: var(--border); transition: background 120ms, height 120ms; }
.col-divider:hover .cd-grip { background: var(--accent-400); height: 3.5rem; }

/* ── Score panel ── */
.score-col { width: 24.5rem; flex-shrink: 0; display: flex; flex-direction: column; gap: 0.55rem; min-height: 0; }
.score-col-head { display: flex; align-items: center; gap: 0.6rem; }
.insp-label { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-faint); }
.score-col-head .loc { margin-left: auto; font-size: 0.75rem; font-weight: 700; color: var(--accent-600); }
.view-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: 0.45rem; background: var(--bg-sunken); padding: 0.1rem; gap: 0.1rem; }
.bawu-app .view-toggle button { width: 1.65rem; height: 1.45rem; border-radius: 0.3rem; color: var(--text-faint); display: inline-flex; align-items: center; justify-content: center; font-size: 0.7rem; }
.bawu-app .view-toggle button.on { background: #fff; color: var(--accent-600); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
.bawu-app .view-toggle button:hover:not(.on) { color: var(--text-dim); }

.page { flex: 1; min-height: 0; background: #fff; border: 1px solid var(--border); border-radius: 0.625rem; box-shadow: var(--shadow); overflow: hidden; display: flex; flex-direction: column; }
.page-img-wrap { position: relative; flex: 1; min-height: 0; overflow: auto; }
.page-img-scaler { position: relative; transform-origin: top left; width: 100%; }
.page-img { display: block; width: 100%; height: auto; }
.page-loading { display: grid; place-items: center; height: 100%; color: var(--text-faint); }
.line-band { position: absolute; left: 2%; right: 2%; border: 2px dashed var(--warn); border-radius: 0.4rem; background: rgba(217, 119, 6, 0.07); pointer-events: none; transition: top 220ms ease, height 220ms ease; }
.zoom-pill { position: sticky; bottom: 0.6rem; float: right; margin-right: 0.6rem; display: inline-flex; align-items: center; gap: 0.1rem; background: rgba(26,26,26,0.85); border-radius: 999px; padding: 0.2rem; z-index: 5; }
.bawu-app .zoom-pill button { width: 1.65rem; height: 1.65rem; border-radius: 999px; color: #fff; font-size: 0.7rem; display: inline-flex; align-items: center; justify-content: center; }
.bawu-app .zoom-pill .zoom-pct { width: auto; padding: 0 0.4rem; color: #d4d4d4; font-size: 0.7rem; font-weight: 700; font-family: var(--mono); }
.bawu-app .zoom-pill button:hover { color: var(--accent-400); }

.page-jianpu { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 1.25rem 1.4rem; font-family: var(--mono); background: linear-gradient(180deg, #fffcf7 0%, #fff 30%); }
.a4-title { text-align: center; font-family: inherit; font-weight: 700; font-size: 1rem; margin-bottom: 0.15rem; }
.a4-sub { text-align: center; font-size: 0.72rem; color: var(--text-faint); margin-bottom: 0.9rem; }
.a4-empty { text-align: center; font-size: 0.8rem; color: var(--text-faint); padding: 1rem; }
/* The staff itself (lines, digits, arcs, lyrics) lives in BawuJianpuStaff.vue,
   which both this panel and the phone reader render. */

.key-card { flex-shrink: 0; background: var(--bg-card); border: 1px solid var(--border); border-radius: 0.75rem; padding: 0.7rem 0.75rem; box-shadow: var(--shadow-sm); }
.key-card-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.key-card-tools { display: inline-flex; gap: 0.3rem; }
.bawu-app .mini-btn { display: inline-flex; align-items: center; gap: 0.3rem; height: 1.65rem; padding: 0 0.55rem; border-radius: 0.4rem; border: 1px solid var(--border); background: #fff; font-size: 0.72rem; font-weight: 600; color: var(--text-dim); transition: border-color 120ms, color 120ms, background 120ms; }
.bawu-app .mini-btn:hover { border-color: var(--accent-400); color: var(--accent-600); background: var(--accent-050); }
.bawu-app .mini-btn i { font-size: 0.7rem; }
.keys { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.5rem; align-items: center; }
.keys button { min-width: 2.4rem; height: 1.9rem; padding: 0 0.55rem; border-radius: 0.45rem; border: 1px solid var(--border); background: #fff; font-weight: 700; font-size: 0.82rem; }
.keys button:hover { background: var(--bg-sunken); }
.keys button.active { background: var(--accent-500); border-color: var(--accent-500); color: #fff; }
.keys button.key-adj { border-style: dashed; border-color: var(--accent-400); color: var(--accent-600); background: var(--accent-050); font-size: 0.78rem; white-space: nowrap; }
.keys button.key-adj.active { border-style: solid; background: var(--accent-500); border-color: var(--accent-500); color: #fff; }
/* The score's imported key — set apart from the plain transpose choices. */
.keys button.is-orig { display: inline-flex; align-items: center; gap: 0.3rem; border-color: var(--accent-400); box-shadow: inset 0 0 0 1px var(--accent-400); white-space: nowrap; }
.keys button.is-orig.active { box-shadow: none; }
.keys button.is-orig .orig-tag { font-size: 0.6rem; font-weight: 800; letter-spacing: 0.03em; text-transform: uppercase; color: var(--accent-600); background: var(--accent-050); border-radius: 0.25rem; padding: 0.05rem 0.25rem; }
.keys button.is-orig.active .orig-tag { color: #fff; background: rgba(255, 255, 255, 0.25); }
.bawu-app .shift-btn { display: inline-flex; align-items: center; gap: 0.15rem; height: 1.9rem; padding: 0 0.55rem; border-radius: 0.45rem; border: 1px solid var(--border); background: #fff; font-size: 0.78rem; font-weight: 700; color: var(--text-dim); font-variant-numeric: tabular-nums; }
.bawu-app .shift-btn:hover:not(:disabled) { border-color: var(--accent-400); color: var(--accent-600); background: var(--accent-050); }
.bawu-app .shift-btn i { font-size: 0.75rem; }
.key-hint { margin-top: 0.5rem; font-size: 0.75rem; color: var(--text-dim); line-height: 1.4; }
.key-hint .fit-ok { color: var(--ok-ink); font-weight: 600; }
.key-hint .fit-bad { color: var(--warn); font-weight: 600; }

/* ── Dock (floating transport pill) ── */
.dock-row { display: flex; justify-content: center; flex-shrink: 0; }
.dock { display: inline-flex; align-items: center; gap: 0.55rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 999px; padding: 0.45rem 0.9rem; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12); flex-wrap: nowrap; max-width: 100%; overflow-x: auto; }
.dock.compact { gap: 0.4rem; padding: 0.4rem 0.65rem; }
.bawu-app .dk-nav { width: 2rem; height: 2rem; border-radius: 999px; color: var(--text-dim); display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem; flex-shrink: 0; }
.bawu-app .dk-nav:hover { background: var(--bg-sunken); color: var(--text); }
.bawu-app .dk-play { width: 2.85rem; height: 2.85rem; border-radius: 999px; background: var(--accent-500); color: #fff; display: grid; place-items: center; flex-shrink: 0; box-shadow: 0 3px 12px rgba(239, 68, 68, 0.4); font-size: 0.95rem; transition: background 120ms, transform 90ms; }
.bawu-app .dk-play:hover { background: var(--accent-600); transform: translateY(-1px); }
.bawu-app .dk-play:active { transform: scale(0.93); }
.bawu-app .dk-play.playing { background: var(--accent-600); box-shadow: inset 0 2px 5px rgba(120, 15, 15, 0.45); }
.dk-div { width: 1px; height: 1.5rem; background: var(--border); flex-shrink: 0; }
.dk-pos { font-family: var(--mono); font-size: 0.78rem; font-weight: 600; color: var(--text-dim); font-variant-numeric: tabular-nums; white-space: nowrap; flex-shrink: 0; }
.dk-bpm { display: inline-flex; align-items: baseline; gap: 0.25rem; white-space: nowrap; flex-shrink: 0; }
.dk-bpm b { font-size: 1rem; font-variant-numeric: tabular-nums; }
.dk-bpm .dk-unit { font-size: 0.6rem; font-weight: 700; color: var(--text-faint); }
.dk-voice { border: 0; background: transparent; font-weight: 700; font-size: 0.8rem; color: var(--text); padding: 0; cursor: pointer; outline: none; flex-shrink: 0; }
.bawu-app .dk-chip { display: inline-flex; align-items: center; gap: 0.35rem; height: 1.85rem; padding: 0 0.65rem; border-radius: 999px; border: 1px solid var(--border); font-size: 0.75rem; font-weight: 600; color: var(--text-dim); background: #fff; flex-shrink: 0; }
.dock.compact .dk-chip { width: 1.85rem; padding: 0; justify-content: center; }
.bawu-app .dk-chip:hover { color: var(--text); border-color: var(--text-faint); }
.bawu-app .dk-chip.on { background: var(--ok-soft); border-color: transparent; color: var(--ok-ink); box-shadow: inset 0 0 0 1px rgba(22, 163, 74, 0.25); }
.bawu-app .dk-chip.live { background: var(--accent-050); border-color: transparent; color: var(--accent-600); box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.25); }
.metro-svg { display: block; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linejoin: round; stroke-linecap: round; }
.dk-pct { font-size: 0.7rem; font-weight: 700; color: var(--text-dim); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.bawu-app .dk-rec { width: 2rem; height: 2rem; border-radius: 999px; border: 2px solid var(--accent-500); color: var(--accent-500); display: grid; place-items: center; flex-shrink: 0; }
.bawu-app .dk-rec:hover { background: var(--accent-050); }
.bawu-app .dk-rec.hot { background: var(--accent-500); color: #fff; animation: bawu-pulse 1.2s ease infinite; }
@keyframes bawu-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); } 50% { box-shadow: 0 0 0 8px rgba(239,68,68,0); } }
.dk-rec .dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: currentColor; }

.takes { position: relative; flex-shrink: 0; }
.bawu-app .dk-takes { font-size: 0.75rem; color: var(--text-dim); font-weight: 600; white-space: nowrap; }
.take-count { font-size: 0.62rem; font-weight: 700; background: var(--bg-sunken); border-radius: 999px; padding: 0.05rem 0.4rem; color: var(--text-faint); }
.takes-panel { display: none; position: absolute; right: 0; bottom: calc(100% + 8px); width: 18rem; background: #fff; border: 1px solid var(--border); border-radius: 0.6rem; box-shadow: var(--shadow-lg); padding: 0.3rem; z-index: 40; }
.takes.open .takes-panel { display: block; }
.takes-panel .ph { display: flex; justify-content: space-between; padding: 0.3rem 0.5rem 0.2rem; font-size: 0.62rem; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-faint); }
.takes-panel .pn { font-size: 0.72rem; color: var(--text-faint); padding: 0 0.5rem 0.4rem; line-height: 1.35; }
.take-row { display: flex; align-items: center; gap: 0.45rem; padding: 0.4rem 0.5rem; border-radius: 0.4rem; font-size: 0.83rem; }
.take-row:hover { background: var(--accent-050); }
.take-row .tn { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.take-row .td { font-size: 0.72rem; color: var(--text-faint); font-family: var(--mono); }
.take-btn { width: 1.6rem; height: 1.6rem; border-radius: 0.35rem; display: inline-flex; align-items: center; justify-content: center; color: var(--text-dim); font-size: 0.72rem; text-decoration: none; }
.take-btn:hover { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.08); color: var(--accent-600); }
.take-btn.danger:hover { color: #c33; }
.takes-empty { padding: 0.8rem 0.5rem; text-align: center; font-size: 0.8rem; color: var(--text-faint); }

/* ── Sliders ── */
.slider { -webkit-appearance: none; appearance: none; width: 6.5rem; height: 4px; border-radius: 2px; background: var(--border); outline: none; cursor: pointer; flex-shrink: 0; }
.slider.seek { flex: 0 1 8rem; }
.slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--accent-500); cursor: pointer; }
.slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; border: none; background: var(--accent-500); cursor: pointer; }

/* ── Buttons / misc ── */
.bawu-app .add-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; background: var(--accent-500); color: #fff; padding: 0.625rem 1.25rem; height: 2.625rem; border-radius: 0.625rem; font-size: 0.9375rem; font-weight: 600; box-shadow: 0 0.125rem 0.5rem rgba(239, 68, 68, 0.25); transition: background 120ms, transform 120ms; }
.bawu-app .add-btn:hover:not(:disabled) { background: var(--accent-600); transform: translateY(-1px); }
.bawu-app .add-btn-lg { height: 3.125rem; padding: 0.875rem 2.5rem; font-size: 1rem; }
.bawu-app .btn-ghost { padding: 0.5rem 1rem; height: 2.5rem; border-radius: 0.625rem; font-size: 0.875rem; color: var(--text-dim); border: 1px solid var(--border); background: #fff; display: inline-flex; align-items: center; gap: 0.375rem; font-weight: 500; transition: all 120ms; }
.bawu-app .btn-ghost:hover:not(:disabled) { border-color: var(--text-faint); color: var(--text); background: var(--bg-sunken); }
.bawu-app .btn-sm { height: 2rem; padding: 0.375rem 0.7rem; font-size: 0.8rem; justify-content: center; }
.bawu-app .btn-primary { padding: 0.5rem 1rem; height: 2.5rem; border-radius: 0.625rem; font-size: 0.875rem; font-weight: 600; color: #fff; background: var(--accent-500); display: inline-flex; align-items: center; gap: 0.375rem; box-shadow: 0 0.125rem 0.5rem rgba(239, 68, 68, 0.25); transition: background 120ms; }
.bawu-app .btn-primary:hover:not(:disabled) { background: var(--accent-600); }
.bawu-app .icon-btn { width: 2.25rem; height: 2.25rem; border-radius: 0.5rem; display: flex; align-items: center; justify-content: center; color: var(--text-faint); transition: all 120ms; flex-shrink: 0; }
.bawu-app .icon-btn:hover { background: var(--bg-sunken); color: var(--text); }
.bawu-app .icon-danger:hover { background: #fff0f0; color: #c33; }

.empty { background: var(--bg-card); border: 2px dashed var(--border); border-radius: var(--radius-lg); padding: 4rem 2.5rem; text-align: center; margin: auto; display: flex; flex-direction: column; align-items: center; gap: 0.75rem; }
.empty-title { font-size: 1.25rem; font-weight: 600; }
.empty-sub { font-size: 0.9375rem; color: var(--text-dim); max-width: 26rem; }
.empty-actions { margin-top: 1rem; display: flex; align-items: center; justify-content: center; gap: 0.6rem; flex-wrap: wrap; }
.action-error { color: oklch(0.55 0.16 25); font-size: 0.875rem; margin: 0; }
.toast { position: absolute; z-index: 50; left: 50%; bottom: 5rem; transform: translateX(-50%); background: var(--text); color: #fff; font-size: 0.85rem; font-weight: 600; padding: 0.55rem 0.9rem; border-radius: 0.6rem; box-shadow: var(--shadow-lg); max-width: 26rem; text-align: center; opacity: 0; pointer-events: none; transition: opacity 160ms, translate 160ms; }
.toast.show { opacity: 1; translate: 0 -4px; }
/* ── Shared scores drawer (phones) ── */
.drawer-scrim { position: absolute; inset: 0; z-index: 30; background: rgba(26, 26, 26, 0.25); }
.drawer { position: absolute; left: 0; top: 0; bottom: 0; width: 18rem; max-width: 85%; z-index: 31; background: #fff; box-shadow: 8px 0 30px rgba(0,0,0,0.15); display: flex; flex-direction: column; gap: 0.6rem; padding: 1rem 0.75rem; transform: translateX(-105%); transition: transform 200ms ease; }
.drawer.open { transform: translateX(0); }
.drawer-head { display: flex; align-items: center; }
.drawer-head b { font-size: 1.15rem; font-weight: 800; }
.bawu-app .drawer-head button { margin-left: auto; width: 2.5rem; height: 2.5rem; border-radius: 0.6rem; color: var(--text-faint); display: inline-flex; align-items: center; justify-content: center; }
.bawu-app .drawer-new { width: 100%; height: 2.5rem; }
.drawer-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 0.4rem; }
.bawu-app .drawer-item { display: flex; align-items: center; gap: 0.6rem; padding: 0.7rem 0.65rem; border-radius: 0.6rem; border: 1px solid var(--border); background: #fff; text-align: left; width: 100%; }
.bawu-app .drawer-item.active { background: var(--accent-050); border-color: var(--accent-500); }
.drawer-item .di-name { flex: 1; min-width: 0; font-weight: 700; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drawer-item.active .di-name { color: var(--accent-600); }
.drawer-item .di-meta { font-size: 0.72rem; color: var(--text-faint); white-space: nowrap; }
/* Landscape: the drawer is in flow and pushes the roll aside (no scrim needed). */
.layout-phone-landscape .drawer {
  position: relative; left: auto; top: auto; bottom: auto;
  flex: 0 0 15rem; width: 15rem; max-width: none; margin-left: -15rem;
  transform: none; box-shadow: none; border-right: 1px solid var(--border);
  transition: margin-left 200ms ease, visibility 0s linear 200ms;
  visibility: hidden;
}
.layout-phone-landscape .drawer.open { margin-left: 0; visibility: visible; transition: margin-left 200ms ease, visibility 0s; }

/* ── Phone portrait (reader) ── */
.pp { flex: 1; min-width: 0; display: flex; flex-direction: column; background: #fffcf7; position: relative; }
.pp-top { display: flex; align-items: center; gap: 0.65rem; padding: 0.75rem 0.85rem; background: #fff; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.bawu-app .pp-btn { width: 2.75rem; height: 2.75rem; border-radius: 0.75rem; border: 1px solid var(--border); background: #fff; color: var(--text-dim); display: grid; place-items: center; font-size: 1rem; flex-shrink: 0; }
.pp-title { flex: 1; min-width: 0; }
.pp-name { font-size: 1rem; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-meta { font-size: 0.7rem; color: var(--text-faint); }
.pp-meta b { color: var(--accent-600); }
.pp-top .seg button { height: 2.25rem; padding: 0 0.75rem; font-size: 0.8rem; }
.pp-sheet { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 1.4rem 1.1rem 2.5rem; font-family: var(--mono); }
.pp-sheet .a4-title { font-size: 1.05rem; }
.pp-empty { flex: 1; display: grid; place-items: center; color: var(--text-faint); }
.pp-hint { position: absolute; left: 50%; transform: translateX(-50%); bottom: 6.9rem; background: #1a1a1a; color: #d4d4d4; font-size: 0.72rem; border-radius: 999px; padding: 0.5rem 1rem; box-shadow: 0 8px 24px rgba(0,0,0,0.25); white-space: nowrap; display: inline-flex; align-items: center; gap: 0.4rem; z-index: 4; }

/* Phone-portrait transport */
.pp-dock { flex-shrink: 0; display: flex; flex-direction: column; gap: 0.5rem; padding: 0.6rem 0.85rem calc(0.7rem + env(safe-area-inset-bottom)); background: #fff; border-top: 1px solid var(--border); box-shadow: 0 -2px 12px rgba(0,0,0,0.06); z-index: 5; }
.ppd-row { display: flex; align-items: center; gap: 0.5rem; }
.ppd-row-bpm { gap: 0.65rem; }
.bawu-app .ppd-nav { width: 2.4rem; height: 2.4rem; border-radius: 999px; color: var(--text-dim); display: inline-flex; align-items: center; justify-content: center; font-size: 0.85rem; flex-shrink: 0; }
.bawu-app .ppd-nav:active { background: var(--bg-sunken); }
.bawu-app .ppd-play { width: 3rem; height: 3rem; border-radius: 999px; background: var(--accent-500); color: #fff; display: grid; place-items: center; font-size: 1rem; flex-shrink: 0; box-shadow: 0 3px 12px rgba(239, 68, 68, 0.4); }
.bawu-app .ppd-play.playing { background: var(--accent-600); }
.ppd-pos { flex: 1; text-align: right; font-family: var(--mono); font-size: 0.78rem; font-weight: 600; color: var(--text-dim); white-space: nowrap; }
.bawu-app .ppd-icon { width: 2.4rem; height: 2.4rem; border-radius: 999px; border: 1px solid var(--border); color: var(--text-dim); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.bawu-app .ppd-icon.on { background: var(--ok-soft); border-color: transparent; color: var(--ok-ink); }
.ppd-bpm { font-size: 0.62rem; font-weight: 700; color: var(--text-faint); white-space: nowrap; }
.ppd-bpm b { font-size: 0.85rem; color: var(--text); }
.pp-dock .slider { flex: 1; min-width: 0; height: 6px; }
.pp-dock .slider.seek { flex: 1.4; }
.pp-dock .slider::-webkit-slider-thumb { width: 20px; height: 20px; }
.pp-dock .slider::-moz-range-thumb { width: 20px; height: 20px; }

/* ── Phone landscape (roll only) ── */
.pl { flex: 1; min-width: 0; position: relative; background: #fff; overflow: hidden; }
.pl-stage { position: absolute; top: 0; left: 0; right: 0; bottom: 2.75rem; display: flex; }
.pl-axis { width: 2.75rem; border-right: 1px solid var(--border-soft); background: #fcfcfb; flex-shrink: 0; display: flex; flex-direction: column; z-index: 2; }
.pl-axis-row { flex: 1 1 0; display: flex; align-items: center; justify-content: center; border-left: 3px solid transparent; border-bottom: 1px solid var(--border-soft); }
.pl-axis-row.active { border-left-color: var(--accent-500); background: var(--accent-050); }
.pl-axis-row b { font-size: clamp(0.7rem, 2.6vh, 0.95rem); font-weight: 800; }
.pl-axis-row.active b { color: var(--accent-600); }
.pl-roll { position: relative; flex: 1; min-width: 0; overflow: hidden; }
.pl-roll .row-bg { position: absolute; inset: 0; display: flex; flex-direction: column; }
.pl-roll .row-bg i { flex: 1 1 0; border-bottom: 1px solid var(--border-soft); }
.pl-roll .row-bg i.active { background: rgba(239, 68, 68, 0.05); }
.note.phone { height: 1.6rem; font-size: 0.72rem; padding: 0 0.55rem; }
.pl-band { position: absolute; left: 0; right: 0; bottom: 0; height: 2.75rem; background: #1a1a1a; display: flex; align-items: center; gap: 0.85rem; padding: 0 0.85rem; z-index: 5; }
.pl-band .band-window { gap: 0.85rem; }
.pl-band .band-syl .bs-main { font-size: 0.95rem; }
.pl-band .band-syl.cur .bs-main { font-size: 1.2rem; }
.pl-top { position: absolute; top: 0.5rem; left: 3.25rem; right: 0.5rem; z-index: 6; display: flex; align-items: center; gap: 0.45rem; }
.bawu-app .pl-pill { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.72rem; font-weight: 700; border-radius: 999px; padding: 0.5rem 0.8rem; white-space: nowrap; }
.pl-pill.dark { background: rgba(26,26,26,0.85); color: #fff; }
.pl-pill.dark.pl-name { overflow: hidden; text-overflow: ellipsis; max-width: 40%; }
.pl-pill.light { background: rgba(255,255,255,0.94); border: 1px solid var(--border); color: var(--text-dim); }
.pl-pill.red { background: var(--accent-050); border: 1px solid var(--accent-100); color: var(--accent-600); }
.pl .spacer { flex: 1; }
.pl-dock { position: absolute; left: 50%; transform: translateX(-50%); bottom: 3.4rem; z-index: 6; display: inline-flex; align-items: center; gap: 0.5rem; background: rgba(26,26,26,0.92); border-radius: 999px; padding: 0.4rem 0.75rem; box-shadow: 0 8px 28px rgba(0,0,0,0.3); max-width: calc(100% - 1rem); }
.bawu-app .pld-nav { width: 2.4rem; height: 2.4rem; border-radius: 999px; color: #d4d4d4; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.bawu-app .pld-play { width: 2.85rem; height: 2.85rem; border-radius: 999px; background: var(--accent-500); color: #fff; display: grid; place-items: center; box-shadow: 0 3px 12px rgba(239,68,68,0.5); flex-shrink: 0; }
.pld-div { width: 1px; height: 1.35rem; background: rgba(255,255,255,0.15); flex-shrink: 0; }
.pld-pos { font-family: var(--mono); font-size: 0.72rem; font-weight: 600; color: #d4d4d4; white-space: nowrap; }
.pld-bpm { display: inline-flex; align-items: baseline; gap: 0.2rem; color: #fff; font-size: 0.6rem; font-weight: 700; white-space: nowrap; }
.pld-bpm b { font-size: 0.85rem; }
.bawu-app .pld-icon { width: 2.1rem; height: 2.1rem; border-radius: 999px; color: #d4d4d4; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.bawu-app .pld-icon.on { background: var(--accent-500); color: #fff; }

/* ── Responsive (desktop widths) ── */
@media (max-width: 767.98px) {
  .bawu-app { height: calc(100vh - 4.75rem); height: calc(100dvh - 4.75rem); }
}
@media (max-width: 1280px) {
  .layout-desktop .score-col { width: 21rem; }
}
@media (max-width: 1080px) {
  .layout-desktop .player { flex-direction: column; overflow-y: auto; }
  .layout-desktop .desk { min-height: 24rem; flex: none; }
  .layout-desktop .score-col { width: 100%; max-height: 22rem; flex: none; }
}

</style>

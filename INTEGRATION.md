<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://unpkg.com/primeicons@7.0.0/primeicons.css">
<style>
  html,body{margin:0;padding:0;background:#f3f2f0;}
  a{color:#b91c1c;text-decoration:none;} a:hover{color:#ef4444;}
  input[type=range]{accent-color:#ef4444;}
  ::-webkit-scrollbar{width:10px;height:10px;} ::-webkit-scrollbar-thumb{background:#d6d4d0;border-radius:6px;border:2px solid #fff;}
</style>
</helmet>
<div style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased;height:100vh;display:flex;flex-direction:column;background:#f3f2f0;overflow:hidden;">

  <!-- ═══════ DESKTOP ═══════ -->
  <sc-if value="{{ isDesktop }}" hint-placeholder-val="{{ true }}">
    <div data-screen-label="Desktop" style="flex:1;min-height:0;display:flex;flex-direction:column;">
      <nav style="display:flex;align-items:center;padding:6px 28px;gap:20px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex-shrink:0;overflow:hidden;">
        <img src="assets/everything.webp" alt="Kumquant" style="height:15px;transform:scale(4);opacity:0.5;margin:0 22px 0 10px;">
        <sc-for list="{{ navGroups }}" as="g" hint-placeholder-count="4">
          <div style="display:flex;flex-direction:column;gap:4px;padding-left:13px;border-left:2px solid {{ g.edge }};">
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;line-height:1;color:{{ g.labC }};">{{ g.label }}</span>
            <div style="display:flex;gap:5px;">
              <sc-for list="{{ g.links }}" as="l" hint-placeholder-count="3">
                <span style="display:flex;align-items:center;gap:7px;padding:5px 12px;border-radius:6px;font-size:14px;font-weight:500;color:{{ l.c }};background:{{ l.bg }};white-space:nowrap;"><i class="{{ l.icon }}" style="font-size:13px;"></i>{{ l.name }}</span>
              </sc-for>
            </div>
          </div>
        </sc-for>
        <div style="margin-left:auto;flex-shrink:0;"><i class="pi pi-user" style="color:#f59e0b;"></i></div>
      </nav>

      <div style="flex:1;min-height:0;display:flex;align-items:stretch;position:relative;">
        <!-- icon rail -->
        <aside style="width:64px;flex-shrink:0;border-right:1px solid #e5e4e1;background:#fff;display:flex;flex-direction:column;align-items:center;padding:12px 0 10px;gap:9px;z-index:20;">
          <button title="Scores" onClick="{{ onRail }}" style="width:42px;height:42px;border-radius:12px;border:1px solid {{ railBtnBc }};background:{{ railBtnBg }};color:{{ railBtnC }};display:grid;place-items:center;font-size:15px;cursor:pointer;"><i class="pi pi-bars"></i></button>
          <button title="New score" onClick="{{ onImportOpen }}" style="width:42px;height:42px;border-radius:12px;border:none;background:#ef4444;color:#fff;display:grid;place-items:center;font-size:15px;box-shadow:0 2px 8px rgba(239,68,68,0.25);cursor:pointer;"><i class="pi pi-plus"></i></button>
          <div style="width:30px;height:1px;background:#eeede9;margin:1px 0;"></div>
          <div style="flex:1;display:flex;flex-direction:column;gap:7px;overflow:hidden;align-items:center;">
            <sc-for list="{{ railIcons }}" as="s" hint-placeholder-count="8">
              <button title="{{ s.name }}" onClick="{{ s.onClick }}" style="width:42px;height:42px;border-radius:12px;border:1.5px solid {{ s.bc }};background:{{ s.bg }};color:{{ s.c }};display:grid;place-items:center;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;">{{ s.ch }}</button>
            </sc-for>
          </div>
          <button title="Tuner" onClick="{{ onTuner }}" style="width:42px;height:42px;border-radius:12px;border:1px solid {{ tunerBtnBc }};background:{{ tunerBtnBg }};color:{{ tunerBtnC }};display:grid;place-items:center;font-size:15px;cursor:pointer;"><i class="pi pi-gauge"></i></button>
        </aside>

        <!-- expanded rail overlay -->
        <sc-if value="{{ railOpen }}" hint-placeholder-val="{{ false }}">
          <div onClick="{{ onRail }}" style="position:absolute;inset:0;z-index:30;background:rgba(26,26,26,0.15);"></div>
          <div style="position:absolute;left:64px;top:0;bottom:0;width:300px;z-index:31;background:#fff;border-right:1px solid #e5e4e1;box-shadow:8px 0 30px rgba(0,0,0,0.1);display:flex;flex-direction:column;gap:12px;padding:16px 12px;">
            <div style="display:flex;align-items:center;">
              <div>
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.09em;color:#ef4444;">Tools</div>
                <div style="display:flex;align-items:baseline;gap:8px;"><b style="font-size:20px;font-weight:800;">Bawu</b><span style="font-size:12px;color:#9a9a9a;">18 scores</span></div>
              </div>
              <button onClick="{{ onRail }}" style="margin-left:auto;width:30px;height:30px;border-radius:8px;border:none;background:none;color:#9a9a9a;cursor:pointer;"><i class="pi pi-times"></i></button>
            </div>
            <div style="display:flex;gap:6px;">
              <button onClick="{{ onImportOpen }}" style="flex:1;height:38px;border-radius:10px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:7px;background:#ef4444;color:#fff;border:none;font-size:13.5px;box-shadow:0 2px 8px rgba(239,68,68,0.25);cursor:pointer;font-family:inherit;"><i class="pi pi-plus" style="font-size:12px;"></i> New score</button>
              <button title="New blank sheet" style="width:38px;height:38px;border-radius:10px;border:1px solid #e5e4e1;background:#fff;color:#5c5c5c;cursor:pointer;"><i class="pi pi-file-edit"></i></button>
              <button title="New folder" style="width:38px;height:38px;border-radius:10px;border:1px solid #e5e4e1;background:#fff;color:#5c5c5c;cursor:pointer;"><i class="pi pi-folder-plus"></i></button>
            </div>
            <div style="display:flex;align-items:center;gap:7px;border:1px solid #e5e4e1;border-radius:10px;padding:0 10px;background:#f3f2f0;">
              <i class="pi pi-search" style="font-size:12px;color:#9a9a9a;"></i>
              <input placeholder="Filter scores…" style="flex:1;min-width:0;border:none;outline:none;background:transparent;padding:8px 0;font-size:13px;font-family:inherit;">
            </div>
            <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding:2px;">
              <sc-for list="{{ railList }}" as="s" hint-placeholder-count="8">
                <button onClick="{{ s.onClick }}" style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:10px;background:{{ s.bg }};border:1px solid {{ s.bc }};cursor:pointer;font-family:inherit;text-align:left;width:100%;">
                  <span style="flex:none;width:28px;height:28px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;background:{{ s.iconBg }};color:{{ s.iconC }};font-size:13px;"><i class="{{ s.icon }}"></i></span>
                  <span style="flex:1;min-width:0;">
                    <span style="display:block;font-weight:700;font-size:13.5px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:{{ s.nameC }};">{{ s.name }}</span>
                    <span style="display:flex;font-size:11px;color:#8a8a8a;margin-top:1px;">{{ s.meta }}<span style="margin-left:auto;color:#b3b3b3;">{{ s.time }}</span></span>
                  </span>
                </button>
              </sc-for>
            </div>
          </div>
        </sc-if>

        <!-- stage -->
        <main style="flex:1;min-width:0;display:flex;flex-direction:column;padding:12px 16px 12px;gap:10px;position:relative;">
          <!-- header -->
          <div style="display:flex;align-items:center;gap:14px;">
            <div style="min-width:0;flex:1;">
              <div style="display:flex;align-items:center;gap:9px;">
                <span style="font-size:19px;font-weight:800;letter-spacing:-0.02em;white-space:nowrap;">左手指月</span>
                <span style="font-size:12.5px;color:#9a9a9a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">The Left Hand Holding the Moon</span>
              </div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:2px;font-size:11px;color:#9a9a9a;white-space:nowrap;">
                <span style="font-weight:700;color:#b91c1c;">1=F</span> · 147 notes · <span style="display:inline-flex;align-items:center;gap:4px;"><i class="pi pi-sparkles" style="font-size:8px;"></i> Gemini Flash Lite</span>
              </div>
            </div>
            <div style="display:inline-flex;align-items:center;background:#fff;border:1px solid #e5e4e1;border-radius:999px;padding:4px;gap:3px;box-shadow:0 2px 10px rgba(0,0,0,0.06);flex-shrink:0;">
              <sc-for list="{{ modeSeg }}" as="m" hint-placeholder-count="3">
                <button onClick="{{ m.onClick }}" style="display:inline-flex;align-items:center;gap:7px;padding:8px 17px;border-radius:999px;font-size:13.5px;font-weight:700;color:{{ m.c }};background:{{ m.bg }};box-shadow:{{ m.sh }};border:none;cursor:pointer;font-family:inherit;white-space:nowrap;"><i class="{{ m.icon }}" style="font-size:12px;"></i> {{ m.name }}</button>
              </sc-for>
              <span style="width:1px;height:22px;background:#e5e4e1;margin:0 3px;"></span>
              <button onClick="{{ onEdit }}" style="display:inline-flex;align-items:center;gap:7px;padding:8px 15px;border-radius:999px;font-size:13.5px;font-weight:700;color:{{ editSegC }};background:{{ editSegBg }};box-shadow:{{ editSegSh }};border:none;cursor:pointer;font-family:inherit;white-space:nowrap;"><i class="pi pi-pencil" style="font-size:12px;"></i> Edit</button>
            </div>
            <div style="flex:1;display:flex;align-items:center;justify-content:flex-end;gap:7px;">
              <button style="height:32px;padding:0 11px;border-radius:9px;font-size:12.5px;color:#5c5c5c;border:1px solid #e5e4e1;background:#fff;display:inline-flex;align-items:center;gap:6px;font-weight:500;cursor:pointer;font-family:inherit;white-space:nowrap;"><i class="pi pi-download" style="font-size:12px;"></i> .mid</button>
              <button onClick="{{ onImportOpen }}" style="height:32px;padding:0 11px;border-radius:9px;font-size:12.5px;color:#b91c1c;border:1px solid #fecaca;background:#fef2f2;display:inline-flex;align-items:center;gap:6px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;"><i class="pi pi-sparkles" style="font-size:12px;"></i> AI convert</button>
              <button style="width:32px;height:32px;border-radius:9px;color:#9a9a9a;border:none;background:none;cursor:pointer;"><i class="pi pi-ellipsis-v"></i></button>
            </div>
          </div>

          <!-- content row: roll + docked jianpu panel -->
          <div style="flex:1;min-height:0;display:flex;gap:12px;">
            <section style="flex:1;min-width:0;display:flex;flex-direction:column;border:1px solid #e5e4e1;border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,0.05);">

              <!-- practice toolbar -->
              <sc-if value="{{ notEdit }}" hint-placeholder-val="{{ true }}">
                <div style="display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid #eeede9;flex-wrap:wrap;">
                  <div style="display:inline-flex;border:1px solid #e5e4e1;border-radius:8px;background:#f3f2f0;padding:2px;gap:2px;" title="Note labels">
                    <button onClick="{{ onNotJp }}" style="min-width:29px;height:25px;border-radius:6px;font-weight:800;font-size:12.5px;color:{{ notJpC }};background:{{ notJpBg }};box-shadow:{{ notJpSh }};border:none;cursor:pointer;font-family:inherit;">1</button>
                    <button onClick="{{ onNotWe }}" style="min-width:29px;height:25px;border-radius:6px;font-weight:800;font-size:12.5px;color:{{ notWeC }};background:{{ notWeBg }};box-shadow:{{ notWeSh }};border:none;cursor:pointer;font-family:inherit;">C</button>
                  </div>
                  <span style="width:1px;height:20px;background:#eeede9;"></span>
                  <button onClick="{{ onLyrics }}" style="display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:999px;border:1px solid {{ lyrBc }};font-size:12px;font-weight:600;color:{{ lyrC }};background:{{ lyrBg }};box-shadow:{{ lyrSh }};cursor:pointer;font-family:inherit;"><i class="pi pi-comment" style="font-size:11px;"></i> Lyrics</button>
                  <sc-if value="{{ lyricsOn }}" hint-placeholder-val="{{ true }}">
                    <div style="display:inline-flex;border:1px solid #e5e4e1;border-radius:8px;background:#f3f2f0;padding:2px;gap:2px;" title="Lyric script">
                      <button onClick="{{ onZh }}" style="height:24px;padding:0 10px;border-radius:6px;font-weight:700;font-size:11.5px;color:{{ zhC }};background:{{ zhBg }};box-shadow:{{ zhSh }};border:none;cursor:pointer;font-family:inherit;">中文</button>
                      <button onClick="{{ onPy }}" style="height:24px;padding:0 10px;border-radius:6px;font-weight:700;font-size:11.5px;color:{{ pyC }};background:{{ pyBg }};box-shadow:{{ pySh }};border:none;cursor:pointer;font-family:inherit;">Pīnyīn</button>
                    </div>
                    <div style="display:inline-flex;border:1px solid #e5e4e1;border-radius:8px;background:#f3f2f0;padding:2px;gap:2px;" title="Where the syllables show">
                      <button onClick="{{ onPosBand }}" style="height:24px;padding:0 10px;border-radius:6px;font-weight:700;font-size:11.5px;color:{{ bandC }};background:{{ bandBg }};box-shadow:{{ bandSh }};border:none;cursor:pointer;font-family:inherit;">Lyric line</button>
                      <button onClick="{{ onPosNotes }}" style="height:24px;padding:0 10px;border-radius:6px;font-weight:700;font-size:11.5px;color:{{ notesC }};background:{{ notesBg }};box-shadow:{{ notesSh }};border:none;cursor:pointer;font-family:inherit;">On notes</button>
                    </div>
                  </sc-if>
                  <div style="flex:1;"></div>
                  <span style="font-size:11.5px;color:#9a9a9a;white-space:nowrap;">{{ modeHint }}</span>
                </div>
              </sc-if>

              <!-- edit toolbar -->
              <sc-if value="{{ editMode }}" hint-placeholder-val="{{ false }}">
                <div style="display:flex;align-items:center;gap:9px;padding:7px 12px;background:#fef2f2;border-bottom:2px solid #ef4444;flex-wrap:wrap;">
                  <button onClick="{{ onEditDone }}" style="display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 14px;border-radius:9px;background:#ef4444;color:#fff;font-size:12.5px;font-weight:700;box-shadow:0 1px 4px rgba(239,68,68,0.35);border:none;cursor:pointer;font-family:inherit;white-space:nowrap;"><i class="pi pi-check" style="font-size:11px;"></i> Done</button>
                  <button onClick="{{ onUndo }}" title="Undo" style="width:30px;height:30px;border-radius:8px;border:1px solid #fecaca;background:#fff;color:{{ undoC }};display:inline-flex;align-items:center;justify-content:center;cursor:pointer;"><i class="pi pi-undo" style="font-size:12px;"></i></button>
                  <span style="width:1px;height:20px;background:#fecaca;"></span>
                  <button onClick="{{ onCopySel }}" style="display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border-radius:8px;border:1px solid #fecaca;background:#fff;color:#b91c1c;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;"><i class="pi pi-clone" style="font-size:11px;"></i> Copy <b style="font-family:ui-monospace,Menlo,monospace;font-weight:600;font-size:10px;color:#d99;">⌘C</b></button>
                  <button onClick="{{ onPasteSel }}" style="display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border-radius:8px;border:1px solid #fecaca;background:#fff;color:{{ pasteC }};font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;"><i class="pi pi-file-import" style="font-size:11px;"></i> Paste <b style="font-family:ui-monospace,Menlo,monospace;font-weight:600;font-size:10px;color:#d99;">⌘V</b></button>
                  <sc-if value="{{ selChip }}" hint-placeholder-val="{{ false }}">
                    <button onClick="{{ onClearSel }}" style="display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 11px;border-radius:999px;background:#fff;border:1px solid #ef4444;color:#b91c1c;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;">{{ selChip }} <i class="pi pi-times" style="font-size:9px;color:#e5a0a0;"></i></button>
                  </sc-if>
                  <div style="flex:1;"></div>
                  <span style="font-size:11.5px;color:#b91c1c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><b style="font-family:ui-monospace,Menlo,monospace;">drag</b> empty space to select many · <b style="font-family:ui-monospace,Menlo,monospace;">1–7</b> insert · <b style="font-family:ui-monospace,Menlo,monospace;">↑↓</b> row · <b style="font-family:ui-monospace,Menlo,monospace;">←→</b> length · <b style="font-family:ui-monospace,Menlo,monospace;">Del</b></span>
                </div>
              </sc-if>

              <!-- deck -->
              <div style="flex:1;min-height:0;display:flex;overflow:hidden;">
                <div style="width:216px;border-right:1px solid #e5e4e1;background:#fcfcfb;flex-shrink:0;display:flex;flex-direction:column;">
                  <sc-for list="{{ axisRows }}" as="r" hint-placeholder-count="8">
                    <div style="flex:1 1 0;min-height:0;overflow:hidden;display:flex;align-items:center;gap:7px;padding:0 11px;border-left:3px solid {{ r.edge }};border-bottom:1px solid #eeede9;background:{{ r.bg }};">
                      <b style="width:30px;font-size:clamp(12px,2.2vh,19px);font-weight:800;color:{{ r.jpC }};">{{ r.big }}</b>
                      <span style="width:32px;font-family:ui-monospace,Menlo,monospace;font-size:clamp(9px,1.25vh,11px);font-weight:600;color:{{ r.pC }};">{{ r.small }}</span>
                      <span style="display:flex;align-items:center;margin-left:auto;gap:3px;">
                        <span style="width:12px;height:12px;border-radius:3px;border:1.5px solid {{ r.h0bc }};background:{{ r.h0bg }};"></span><span style="width:4px;"></span>
                        <span style="width:11px;height:11px;border-radius:50%;border:1.5px solid {{ r.h1bc }};background:{{ r.h1bg }};"></span><span style="width:11px;height:11px;border-radius:50%;border:1.5px solid {{ r.h2bc }};background:{{ r.h2bg }};"></span><span style="width:11px;height:11px;border-radius:50%;border:1.5px solid {{ r.h3bc }};background:{{ r.h3bg }};"></span>
                        <span style="width:7px;"></span>
                        <span style="width:11px;height:11px;border-radius:50%;border:1.5px solid {{ r.h4bc }};background:{{ r.h4bg }};"></span><span style="width:11px;height:11px;border-radius:50%;border:1.5px solid {{ r.h5bc }};background:{{ r.h5bg }};"></span><span style="width:11px;height:11px;border-radius:50%;border:1.5px solid {{ r.h6bc }};background:{{ r.h6bg }};"></span>
                      </span>
                    </div>
                  </sc-for>
                </div>
                <div onPointerDown="{{ onRollDown }}" onPointerMove="{{ onRollMove }}" onPointerUp="{{ onRollUp }}" style="position:relative;flex:1;min-width:0;overflow:hidden;background:#fff;cursor:{{ rollCursor }};touch-action:none;">
                  <div style="position:absolute;inset:0;display:flex;flex-direction:column;">
                    <sc-for list="{{ rollRows }}" as="rr" hint-placeholder-count="8"><i style="flex:1 1 0;border-bottom:1px solid #eeede9;background:{{ rr.bg }};display:block;"></i></sc-for>
                  </div>
                  <div style="position:absolute;top:0;bottom:0;left:0;width:3800px;transform:{{ laneTx }};">
                    <sc-for list="{{ barlines }}" as="b" hint-placeholder-count="4">
                      <div style="position:absolute;top:0;bottom:0;width:1px;background:#efeeeb;left:{{ b.x }}px;"><span style="position:absolute;top:3px;left:6px;font-size:10px;font-family:ui-monospace,Menlo,monospace;color:#c0beba;">{{ b.n }}</span></div>
                    </sc-for>
                    <sc-for list="{{ laneNotes }}" as="n" hint-placeholder-count="10">
                      <div onClick="{{ n.onClick }}" onPointerDown="{{ n.onDown }}" title="{{ n.title }}" style="position:absolute;border-radius:999px;display:flex;align-items:center;gap:6px;padding:0 11px;font-size:13px;font-weight:700;transform:translateY(-50%);height:30px;white-space:nowrap;cursor:{{ n.cursor }};left:{{ n.x }}px;width:{{ n.w }}px;top:{{ n.top }};background:{{ n.bg }};border:{{ n.border }};color:{{ n.color }};box-shadow:{{ n.shadow }};z-index:{{ n.z }};outline:{{ n.outline }};outline-offset:2px;">
                        <span style="overflow:hidden;text-overflow:ellipsis;">{{ n.label }}</span>
                        <sc-if value="{{ n.syl }}" hint-placeholder-val="{{ false }}"><span style="font-weight:500;font-size:10.5px;opacity:0.85;overflow:hidden;text-overflow:ellipsis;">{{ n.syl }}</span></sc-if>
                        <sc-if value="{{ n.warn }}" hint-placeholder-val="{{ false }}"><span style="font-size:10px;">⚠</span></sc-if>
                        <sc-if value="{{ n.handle }}" hint-placeholder-val="{{ false }}"><span style="position:absolute;top:0;right:0;bottom:0;width:9px;cursor:ew-resize;"><span style="position:absolute;top:50%;right:3px;transform:translateY(-50%);width:2px;height:45%;border-radius:1px;background:currentColor;opacity:0.5;display:block;"></span></span></sc-if>
                      </div>
                    </sc-for>
                  </div>
                  <sc-if value="{{ mqOn }}" hint-placeholder-val="{{ false }}">
                    <div style="position:absolute;border:1.5px dashed #ef4444;background:rgba(239,68,68,0.06);border-radius:6px;z-index:6;pointer-events:none;left:{{ mqX }}px;top:{{ mqY }}px;width:{{ mqW }}px;height:{{ mqH }}px;"></div>
                  </sc-if>
                  <div style="position:absolute;top:0;bottom:0;left:168px;width:2px;background:#ef4444;z-index:4;box-shadow:0 0 14px rgba(239,68,68,0.45);pointer-events:none;"></div>
                  <div style="position:absolute;top:0;bottom:0;left:108px;width:120px;background:linear-gradient(90deg,rgba(239,68,68,0) 0%,rgba(239,68,68,0.06) 50%,rgba(239,68,68,0) 100%);z-index:3;pointer-events:none;"></div>
                  <span style="position:absolute;top:8px;left:176px;font-size:9px;font-weight:800;letter-spacing:0.08em;color:#ef4444;z-index:5;pointer-events:none;">NOW</span>
                  <div style="position:absolute;right:10px;bottom:8px;font-size:10px;color:#9a9a9a;background:rgba(255,255,255,0.92);border:1px solid #e5e4e1;border-radius:6px;padding:2px 8px;z-index:4;pointer-events:none;">T back · 1–3 · 4–6 · ● cover</div>
                </div>
              </div>

              <!-- karaoke band -->
              <sc-if value="{{ showBand }}" hint-placeholder-val="{{ true }}">
                <div style="display:flex;align-items:center;gap:20px;padding:15px 24px;border-top:1px solid #eeede9;background:#1a1a1a;flex-shrink:0;">
                  <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8a8a8a;flex-shrink:0;">Lyrics</span>
                  <div style="flex:1;display:flex;align-items:baseline;justify-content:center;gap:24px;overflow:hidden;">
                    <sc-for list="{{ karaoke }}" as="k" hint-placeholder-count="7">
                      <span style="display:inline-flex;flex-direction:column;align-items:center;gap:3px;flex-shrink:0;">
                        <span style="font-size:{{ k.size }}px;font-weight:{{ k.weight }};color:{{ k.color }};line-height:1.15;">{{ k.t }}</span>
                        <span style="font-size:13px;color:{{ k.subC }};font-weight:500;">{{ k.sub }}</span>
                      </span>
                    </sc-for>
                  </div>
                  <span style="font-size:11.5px;font-weight:700;color:#f87171;flex-shrink:0;">{{ locLabel }}</span>
                </div>
              </sc-if>

              <!-- inspector (edit) -->
              <sc-if value="{{ editMode }}" hint-placeholder-val="{{ false }}">
                <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-top:1px solid #e5e4e1;background:#fcfcfb;overflow:hidden;">
                  <span style="font-size:12.5px;font-weight:700;white-space:nowrap;">{{ selLabel }}</span>
                  <span style="width:1px;height:22px;background:#e5e4e1;flex-shrink:0;"></span>
                  <span style="font-size:11.5px;color:#5c5c5c;white-space:nowrap;">Degree</span>
                  <div style="display:inline-flex;border:1px solid #e5e4e1;border-radius:8px;background:#f3f2f0;padding:2px;gap:1px;flex-shrink:0;">
                    <sc-for list="{{ degSeg }}" as="d" hint-placeholder-count="7"><button onClick="{{ d.onClick }}" style="width:24px;height:24px;border-radius:6px;font-weight:800;font-size:12px;color:{{ d.c }};background:{{ d.bg }};box-shadow:{{ d.sh }};border:none;cursor:pointer;font-family:inherit;">{{ d.d }}</button></sc-for>
                  </div>
                  <span style="font-size:11.5px;color:#5c5c5c;white-space:nowrap;">Row</span>
                  <span style="display:inline-flex;gap:3px;flex-shrink:0;">
                    <button onClick="{{ onRowDown }}" style="width:24px;height:24px;border-radius:7px;border:1px solid #e5e4e1;background:#fff;font-size:10px;color:#5c5c5c;cursor:pointer;"><i class="pi pi-angle-down"></i></button>
                    <span style="min-width:38px;height:24px;border-radius:7px;border:1px solid #e5e4e1;background:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">{{ selRowLabel }}</span>
                    <button onClick="{{ onRowUp }}" style="width:24px;height:24px;border-radius:7px;border:1px solid #e5e4e1;background:#fff;font-size:10px;color:#5c5c5c;cursor:pointer;"><i class="pi pi-angle-up"></i></button>
                  </span>
                  <span style="font-size:11.5px;color:#5c5c5c;white-space:nowrap;">Length</span>
                  <div style="display:inline-flex;border:1px solid #e5e4e1;border-radius:8px;background:#f3f2f0;padding:2px;gap:1px;flex-shrink:0;">
                    <sc-for list="{{ lenSeg }}" as="l" hint-placeholder-count="4"><button onClick="{{ l.onClick }}" style="padding:0 8px;height:24px;border-radius:6px;font-size:11.5px;font-weight:700;color:{{ l.c }};background:{{ l.bg }};box-shadow:{{ l.sh }};border:none;cursor:pointer;font-family:inherit;">{{ l.t }}</button></sc-for>
                  </div>
                  <span style="font-size:11.5px;color:#5c5c5c;white-space:nowrap;">Lyric</span>
                  <input value="{{ selSyl }}" onChange="{{ onSylChange }}" style="width:60px;height:26px;border:1px solid #e5e4e1;border-radius:7px;background:#fff;padding:0 8px;font-size:12.5px;font-family:inherit;outline:none;">
                  <div style="flex:1;"></div>
                  <button onClick="{{ onDeleteSel }}" style="display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:8px;border:1px solid #fecaca;background:#fff;color:#c33;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;"><i class="pi pi-trash" style="font-size:11px;"></i> Delete</button>
                </div>
              </sc-if>
            </section>

            <!-- docked jianpu panel (1a style) -->
            <aside style="width:392px;flex-shrink:0;display:flex;flex-direction:column;gap:9px;min-height:0;">
              <div style="display:flex;align-items:center;gap:9px;">
                <span style="font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#9a9a9a;">{{ panelTitle }}</span>
                <div style="display:inline-flex;border:1px solid #e5e4e1;border-radius:7px;background:#f3f2f0;padding:2px;gap:2px;">
                  <button onClick="{{ onViewPic }}" title="Original picture" style="width:27px;height:23px;border-radius:5px;color:{{ vPicC }};background:{{ vPicBg }};box-shadow:{{ vPicSh }};display:inline-flex;align-items:center;justify-content:center;font-size:11px;border:none;cursor:pointer;"><i class="pi pi-image"></i></button>
                  <button onClick="{{ onViewJp }}" title="Transcribed jianpu" style="width:27px;height:23px;border-radius:5px;color:{{ vJpC }};background:{{ vJpBg }};box-shadow:{{ vJpSh }};display:inline-flex;align-items:center;justify-content:center;font-size:11px;border:none;cursor:pointer;"><i class="pi pi-list"></i></button>
                </div>
                <span style="margin-left:auto;font-size:12px;font-weight:700;color:#b91c1c;">{{ locLabel }}</span>
              </div>
              <div style="flex:1;min-height:0;background:#fff;border:1px solid #e5e4e1;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.06);overflow:hidden;display:flex;flex-direction:column;">
                <sc-if value="{{ showPic }}" hint-placeholder-val="{{ false }}">
                  <div style="flex:1;min-height:0;position:relative;overflow:auto;">
                    <div style="min-width:100%;min-height:100%;display:flex;align-items:center;justify-content:center;">
                      <div style="width:100%;aspect-ratio:3/4;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:repeating-linear-gradient(45deg,#faf9f7,#faf9f7 12px,#f3f1ed 12px,#f3f1ed 24px);color:#9a9a9a;transform:{{ picZoom }};transform-origin:top left;flex-shrink:0;">
                        <i class="pi pi-image" style="font-size:26px;"></i>
                        <span style="font-family:ui-monospace,Menlo,monospace;font-size:11.5px;">original score photo</span>
                      </div>
                    </div>
                    <div style="position:sticky;bottom:10px;float:right;margin-right:10px;display:inline-flex;align-items:center;gap:2px;background:rgba(26,26,26,0.85);border-radius:999px;padding:3px;z-index:5;">
                      <button onClick="{{ onZoomOut }}" title="Zoom out" style="width:26px;height:26px;border-radius:999px;border:none;background:none;color:#fff;font-size:11px;cursor:pointer;"><i class="pi pi-minus"></i></button>
                      <button onClick="{{ onZoomReset }}" title="Reset zoom" style="height:26px;padding:0 7px;border-radius:999px;border:none;background:none;color:#d4d4d4;font-size:11px;font-weight:700;font-family:ui-monospace,Menlo,monospace;cursor:pointer;">{{ picZoomPct }}</button>
                      <button onClick="{{ onZoomIn }}" title="Zoom in" style="width:26px;height:26px;border-radius:999px;border:none;background:none;color:#fff;font-size:11px;cursor:pointer;"><i class="pi pi-plus"></i></button>
                    </div>
                  </div>
                </sc-if>
                <sc-if value="{{ showJp }}" hint-placeholder-val="{{ true }}">
                  <div style="flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:20px 22px;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;background:linear-gradient(180deg,#fffcf7 0%,#fff 30%);">
                    <div style="text-align:center;font-weight:700;font-size:15px;margin-bottom:2px;">左手指月</div>
                    <div style="text-align:center;font-size:11px;color:#9a9a9a;margin-bottom:14px;">Jianpu · 1=F · 4/4 · via Gemini Flash Lite</div>
                    <div style="display:flex;flex-direction:column;gap:18px;">
                      <sc-for list="{{ jianpuLines }}" as="line" hint-placeholder-count="4">
                        <div style="display:flex;flex-wrap:wrap;gap:{{ line.gap }};justify-content:center;align-items:flex-end;padding:7px 4px 20px;border-radius:5px;outline:{{ line.outline }};outline-offset:2px;background:{{ line.bg }};">
                          <sc-for list="{{ line.notes }}" as="jn" hint-placeholder-count="8">
                            <span style="position:relative;display:inline-flex;align-items:flex-end;justify-content:center;min-width:{{ jn.minW }};gap:1px;font-size:16px;font-weight:600;line-height:1.2;padding:2px;border-radius:3px;background:{{ jn.bg }};outline:{{ jn.outline }};outline-offset:1px;color:{{ jn.color }};">
                              <span style="position:relative;display:inline-block;border-bottom:{{ jn.u1 }};padding-bottom:1px;">
                                <sc-if value="{{ jn.hi }}" hint-placeholder-val="{{ false }}"><span style="position:absolute;left:50%;transform:translateX(-50%);bottom:100%;margin-bottom:2px;width:3px;height:3px;border-radius:50%;background:currentColor;"></span></sc-if>
                                <sc-if value="{{ jn.lo }}" hint-placeholder-val="{{ false }}"><span style="position:absolute;left:50%;transform:translateX(-50%);top:100%;margin-top:4px;width:3px;height:3px;border-radius:50%;background:currentColor;"></span></sc-if>
                                {{ jn.d }}
                              </span>
                              <sc-if value="{{ jn.dash }}" hint-placeholder-val="{{ false }}"><span style="color:#5c5c5c;font-weight:400;">{{ jn.dash }}</span></sc-if>
                              <sc-if value="{{ jn.ly }}" hint-placeholder-val="{{ false }}"><span style="position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:4px;font-size:12px;font-weight:500;color:{{ jn.lyC }};white-space:nowrap;">{{ jn.ly }}</span></sc-if>
                            </span>
                          </sc-for>
                        </div>
                      </sc-for>
                    </div>
                  </div>
                </sc-if>
              </div>
              <div style="flex-shrink:0;background:#fff;border:1px solid #e5e4e1;border-radius:12px;padding:11px 12px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                  <span style="font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#9a9a9a;">Key &amp; transpose</span>
                  <div style="display:inline-flex;gap:5px;">
                    <button style="display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border-radius:7px;border:1px solid #e5e4e1;background:#fff;font-size:11px;font-weight:600;color:#5c5c5c;cursor:pointer;font-family:inherit;"><i class="pi pi-copy" style="font-size:10px;"></i> Copy</button>
                    <button style="display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border-radius:7px;border:1px solid #e5e4e1;background:#fff;font-size:11px;font-weight:600;color:#5c5c5c;cursor:pointer;font-family:inherit;"><i class="pi pi-sliders-h" style="font-size:10px;"></i> Adjust</button>
                  </div>
                </div>
                <div style="display:flex;gap:5px;margin-top:8px;align-items:center;">
                  <sc-for list="{{ keySeg }}" as="k" hint-placeholder-count="5">
                    <button onClick="{{ k.onClick }}" style="min-width:40px;height:30px;padding:0 8px;border-radius:7px;border:{{ k.border }};background:{{ k.bg }};font-weight:700;font-size:{{ k.fs }}px;color:{{ k.c }};cursor:pointer;font-family:inherit;white-space:nowrap;">{{ k.t }}</button>
                  </sc-for>
                  <div style="flex:1;"></div>
                  <button title="All notes a semitone down" style="height:30px;padding:0 9px;border-radius:7px;border:1px solid #e5e4e1;background:#fff;font-size:12px;font-weight:700;color:#5c5c5c;cursor:pointer;font-family:inherit;white-space:nowrap;"><i class="pi pi-angle-down" style="font-size:11px;"></i> ½</button>
                  <button title="All notes a semitone up" style="height:30px;padding:0 9px;border-radius:7px;border:1px solid #e5e4e1;background:#fff;font-size:12px;font-weight:700;color:#5c5c5c;cursor:pointer;font-family:inherit;white-space:nowrap;"><i class="pi pi-angle-up" style="font-size:11px;"></i> ½</button>
                </div>
                <div style="margin-top:8px;font-size:12px;color:#5c5c5c;">Playable <b>C4–D5</b> (no natural B) · <span style="color:#d97706;font-weight:600;">63 of 147 out of range</span></div>
              </div>
            </aside>
          </div>

          <!-- dock -->
          <div style="display:flex;justify-content:center;flex-shrink:0;">
            <div style="display:inline-flex;align-items:center;gap:10px;background:#fff;border:1px solid #e5e4e1;border-radius:999px;padding:7px 14px;box-shadow:0 8px 28px rgba(0,0,0,0.12);flex-wrap:nowrap;">
              <button onClick="{{ onStart }}" title="Back to start" style="width:32px;height:32px;border-radius:999px;border:none;background:none;color:#5c5c5c;cursor:pointer;"><i class="pi pi-step-backward" style="font-size:12px;"></i></button>
              <button onClick="{{ onPrev }}" title="Previous note" style="width:32px;height:32px;border-radius:999px;border:none;background:none;color:#5c5c5c;cursor:pointer;"><i class="pi pi-chevron-left" style="font-size:12px;"></i></button>
              <button onClick="{{ onPlay }}" title="Play / pause" style="width:46px;height:46px;border-radius:999px;background:{{ playBg }};color:#fff;border:none;box-shadow:0 3px 12px rgba(239,68,68,0.4);cursor:pointer;"><i class="{{ playIcon }}" style="font-size:15px;"></i></button>
              <button onClick="{{ onNext }}" title="Next note" style="width:32px;height:32px;border-radius:999px;border:none;background:none;color:#5c5c5c;cursor:pointer;"><i class="pi pi-chevron-right" style="font-size:12px;"></i></button>
              <button onClick="{{ onStop }}" title="Stop" style="width:32px;height:32px;border-radius:999px;border:none;background:none;color:#5c5c5c;cursor:pointer;"><i class="pi pi-stop" style="font-size:12px;"></i></button>
              <span style="width:1px;height:24px;background:#e5e4e1;"></span>
              <span style="font-family:ui-monospace,Menlo,monospace;font-size:12.5px;font-weight:600;color:#5c5c5c;white-space:nowrap;">{{ posLabel }}</span>
              <input type="range" min="0" max="{{ seekMax }}" value="{{ seekVal }}" onChange="{{ onSeek }}" style="width:{{ seekW }}px;">
              <span style="width:1px;height:24px;background:#e5e4e1;"></span>
              <span style="display:inline-flex;align-items:baseline;gap:4px;white-space:nowrap;"><b style="font-size:16px;font-variant-numeric:tabular-nums;">{{ bpm }}</b><span style="font-size:9.5px;font-weight:700;color:#9a9a9a;">BPM</span></span>
              <input type="range" min="40" max="160" value="{{ bpm }}" onChange="{{ onBpm }}" style="width:{{ bpmW }}px;">
              <span style="width:1px;height:24px;background:#e5e4e1;"></span>
              <sc-if value="{{ dockWide }}" hint-placeholder-val="{{ true }}">
                <span title="Synth voice" style="font-size:12px;font-weight:700;white-space:nowrap;cursor:pointer;">Bawu ▾</span>
                <button onClick="{{ onMetro }}" style="display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 11px;border-radius:999px;border:1px solid {{ metroBc }};font-size:11.5px;font-weight:600;color:{{ metroC }};background:{{ metroBg }};box-shadow:{{ metroSh }};cursor:pointer;font-family:inherit;white-space:nowrap;"><svg width="12" height="12" viewBox="0 0 12 12" style="display:block;"><path d="M4.2 1.5 L7.8 1.5 L10 10.5 L2 10.5 Z" style="fill:none;stroke:currentColor;stroke-width:1.3;stroke-linejoin:round;"></path><line x1="6" y1="8.6" x2="8.8" y2="2.6" style="stroke:currentColor;stroke-width:1.3;stroke-linecap:round;"></line></svg> Metronome</button>
                <button onClick="{{ onReverb }}" style="display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 11px;border-radius:999px;border:1px solid {{ revBc }};font-size:11.5px;font-weight:600;color:{{ revC }};background:{{ revBg }};box-shadow:{{ revSh }};cursor:pointer;font-family:inherit;white-space:nowrap;"><i class="pi pi-wifi" style="font-size:11px;transform:rotate(90deg);"></i> Reverb</button>
                <sc-if value="{{ reverbOn }}" hint-placeholder-val="{{ false }}">
                  <input type="range" min="0" max="100" value="{{ reverbLevel }}" onChange="{{ onReverbLevel }}" title="Reverb amount" style="width:64px;">
                  <span style="font-size:10.5px;font-weight:700;color:#5c5c5c;font-variant-numeric:tabular-nums;white-space:nowrap;">{{ reverbLevel }}%</span>
                </sc-if>
                <button onClick="{{ onMic }}" style="display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 11px;border-radius:999px;border:1px solid {{ micBc }};font-size:11.5px;font-weight:600;color:{{ micC }};background:{{ micBg }};box-shadow:{{ micSh }};cursor:pointer;font-family:inherit;white-space:nowrap;"><span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;"></span> Mic detect</button>
              </sc-if>
              <sc-if value="{{ dockCompact }}" hint-placeholder-val="{{ false }}">
                <button onClick="{{ onMetro }}" title="Metronome" style="width:28px;height:28px;border-radius:999px;border:1px solid {{ metroBc }};color:{{ metroC }};background:{{ metroBg }};box-shadow:{{ metroSh }};display:inline-flex;align-items:center;justify-content:center;cursor:pointer;"><svg width="12" height="12" viewBox="0 0 12 12" style="display:block;"><path d="M4.2 1.5 L7.8 1.5 L10 10.5 L2 10.5 Z" style="fill:none;stroke:currentColor;stroke-width:1.3;stroke-linejoin:round;"></path><line x1="6" y1="8.6" x2="8.8" y2="2.6" style="stroke:currentColor;stroke-width:1.3;stroke-linecap:round;"></line></svg></button>
                <button onClick="{{ onReverb }}" title="Reverb" style="width:28px;height:28px;border-radius:999px;border:1px solid {{ revBc }};color:{{ revC }};background:{{ revBg }};box-shadow:{{ revSh }};display:inline-flex;align-items:center;justify-content:center;cursor:pointer;"><i class="pi pi-wifi" style="font-size:11px;transform:rotate(90deg);"></i></button>
                <sc-if value="{{ reverbOn }}" hint-placeholder-val="{{ false }}">
                  <input type="range" min="0" max="100" value="{{ reverbLevel }}" onChange="{{ onReverbLevel }}" title="Reverb amount" style="width:48px;">
                </sc-if>
                <button onClick="{{ onMic }}" title="Mic detect" style="width:28px;height:28px;border-radius:999px;border:1px solid {{ micBc }};color:{{ micC }};background:{{ micBg }};box-shadow:{{ micSh }};display:inline-flex;align-items:center;justify-content:center;cursor:pointer;"><i class="pi pi-microphone" style="font-size:11px;"></i></button>
              </sc-if>
              <button title="Record a take" style="width:30px;height:30px;border-radius:999px;border:2px solid #ef4444;color:#ef4444;display:inline-flex;align-items:center;justify-content:center;background:none;cursor:pointer;flex-shrink:0;"><span style="width:8px;height:8px;border-radius:50%;background:currentColor;"></span></button>
              <sc-if value="{{ dockWide }}" hint-placeholder-val="{{ true }}">
                <span style="font-size:11.5px;color:#5c5c5c;font-weight:600;white-space:nowrap;">Takes <span style="font-size:9.5px;background:#f3f2f0;border-radius:999px;padding:1px 6px;color:#9a9a9a;">0</span></span>
              </sc-if>
            </div>
          </div>

          <!-- tuner popup -->
          <sc-if value="{{ tunerOpen }}" hint-placeholder-val="{{ false }}">
            <div data-screen-label="Tuner" style="position:absolute;left:18px;bottom:16px;width:320px;z-index:40;background:#fff;border:1px solid #e5e4e1;border-radius:16px;box-shadow:0 16px 44px rgba(0,0,0,0.18);padding:14px 16px 16px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:12.5px;font-weight:800;display:inline-flex;align-items:center;gap:6px;"><i class="pi pi-gauge" style="color:#ef4444;"></i> Tuner</span>
                <span style="font-size:10.5px;color:#9a9a9a;margin-left:auto;">A4 = 440 Hz</span>
                <button onClick="{{ onTuner }}" style="width:24px;height:24px;border-radius:6px;border:none;background:none;color:#9a9a9a;font-size:10px;cursor:pointer;"><i class="pi pi-times"></i></button>
              </div>
              <div style="display:flex;align-items:baseline;justify-content:center;gap:13px;margin-top:10px;">
                <span style="font-size:14px;color:#c9c7c2;font-weight:600;">C♯4</span>
                <span style="font-size:46px;font-weight:800;letter-spacing:-0.02em;color:{{ tunerNoteC }};line-height:1;">D4</span>
                <span style="font-size:14px;color:#c9c7c2;font-weight:600;">D♯4</span>
              </div>
              <div style="position:relative;margin-top:12px;">
                <svg viewBox="0 0 300 120" style="width:100%;display:block;">
                  <path d="{{ wedge }}" style="fill:rgba(22,163,74,0.12);"></path>
                  <sc-for list="{{ ticks }}" as="tk" hint-placeholder-count="4"><line x1="{{ tk.x1 }}" y1="{{ tk.y1 }}" x2="{{ tk.x2 }}" y2="{{ tk.y2 }}" style="stroke:{{ tk.stroke }};stroke-width:{{ tk.w }}px;"></line></sc-for>
                  <g style="transform:rotate({{ needleDeg }}deg);transform-origin:150px 112px;transition:transform 90ms linear;">
                    <line x1="150" y1="112" x2="150" y2="18" style="stroke:{{ tunerNoteC }};stroke-width:4px;stroke-linecap:round;"></line>
                    <circle cx="150" cy="112" r="6" style="fill:#44403c;"></circle>
                  </g>
                </svg>
              </div>
              <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-top:6px;">
                <b style="font-size:20px;font-variant-numeric:tabular-nums;color:{{ tunerNoteC }};">{{ centsLabel }}</b>
                <span style="font-size:12px;color:#9a9a9a;font-variant-numeric:tabular-nums;">{{ hzLabel }}</span>
              </div>
              <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:10px;padding:7px 10px;border-radius:9px;background:#fef2f2;border:1px solid #fee2e2;">
                <span style="font-size:10px;font-weight:700;letter-spacing:0.05em;color:#b91c1c;">TARGET</span>
                <span style="font-size:12.5px;font-weight:700;">6̣ · D4 <span style="color:#9a9a9a;font-weight:500;">(current note)</span></span>
              </div>
            </div>
          </sc-if>
        </main>
      </div>
    </div>
  </sc-if>

  <!-- ═══════ PHONE · PORTRAIT (vertical mode: jianpu reader) ═══════ -->
  <sc-if value="{{ isPhoneP }}" hint-placeholder-val="{{ false }}">
    <div data-screen-label="Phone portrait" style="flex:1;min-height:0;display:flex;flex-direction:column;background:#fffcf7;position:relative;">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#fff;border-bottom:1px solid #e5e4e1;flex-shrink:0;">
        <button onClick="{{ onRail }}" style="width:44px;height:44px;border-radius:12px;border:1px solid #e5e4e1;background:#fff;color:#5c5c5c;font-size:16px;cursor:pointer;"><i class="pi pi-bars"></i></button>
        <div style="flex:1;min-width:0;">
          <div style="font-size:16px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">左手指月</div>
          <div style="font-size:11px;color:#9a9a9a;"><b style="color:#b91c1c;">1=F</b> · 4/4 · 147 notes</div>
        </div>
        <div style="display:inline-flex;border:1px solid #e5e4e1;border-radius:9px;background:#f3f2f0;padding:2px;gap:2px;">
          <button onClick="{{ onZh }}" style="height:36px;padding:0 12px;border-radius:7px;font-weight:700;font-size:13px;color:{{ zhC }};background:{{ zhBg }};box-shadow:{{ zhSh }};border:none;cursor:pointer;font-family:inherit;">中文</button>
          <button onClick="{{ onPy }}" style="height:36px;padding:0 12px;border-radius:7px;font-weight:700;font-size:13px;color:{{ pyC }};background:{{ pyBg }};box-shadow:{{ pySh }};border:none;cursor:pointer;font-family:inherit;">Pīnyīn</button>
        </div>
      </div>
      <div style="flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:22px 18px 40px;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;">
        <div style="text-align:center;font-weight:700;font-size:17px;margin-bottom:2px;">左手指月 (The Left Hand Holding the Moon)</div>
        <div style="text-align:center;font-size:12px;color:#9a9a9a;margin-bottom:20px;">Jianpu · 1=F · 4/4</div>
        <div style="display:flex;flex-direction:column;gap:26px;">
          <sc-for list="{{ jianpuLines }}" as="line" hint-placeholder-count="4">
            <div style="display:flex;flex-wrap:wrap;gap:{{ line.gapPhone }};justify-content:center;align-items:flex-end;padding:8px 2px 26px;">
              <sc-for list="{{ line.notes }}" as="jn" hint-placeholder-count="8">
                <span style="position:relative;display:inline-flex;align-items:flex-end;justify-content:center;min-width:{{ jn.minW }};gap:1px;font-size:21px;font-weight:600;line-height:1.2;padding:2px;color:#1a1a1a;">
                  <span style="position:relative;display:inline-block;border-bottom:{{ jn.u1 }};padding-bottom:1px;">
                    <sc-if value="{{ jn.hi }}" hint-placeholder-val="{{ false }}"><span style="position:absolute;left:50%;transform:translateX(-50%);bottom:100%;margin-bottom:2px;width:4px;height:4px;border-radius:50%;background:currentColor;"></span></sc-if>
                    <sc-if value="{{ jn.lo }}" hint-placeholder-val="{{ false }}"><span style="position:absolute;left:50%;transform:translateX(-50%);top:100%;margin-top:5px;width:4px;height:4px;border-radius:50%;background:currentColor;"></span></sc-if>
                    {{ jn.d }}
                  </span>
                  <sc-if value="{{ jn.dash }}" hint-placeholder-val="{{ false }}"><span style="color:#5c5c5c;font-weight:400;">{{ jn.dash }}</span></sc-if>
                  <sc-if value="{{ jn.ly }}" hint-placeholder-val="{{ false }}"><span style="position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:5px;font-size:14px;font-weight:500;color:#5c5c5c;white-space:nowrap;">{{ jn.ly }}</span></sc-if>
                </span>
              </sc-for>
            </div>
          </sc-for>
        </div>
      </div>
      <sc-if value="{{ railOpen }}" hint-placeholder-val="{{ false }}">
        <div onClick="{{ onRail }}" style="position:absolute;inset:0;z-index:30;background:rgba(26,26,26,0.25);"></div>
        <div style="position:absolute;left:0;top:0;bottom:0;width:290px;z-index:31;background:#fff;box-shadow:8px 0 30px rgba(0,0,0,0.15);display:flex;flex-direction:column;gap:10px;padding:16px 12px;">
          <div style="display:flex;align-items:center;"><b style="font-size:19px;font-weight:800;">Scores</b><button onClick="{{ onRail }}" style="margin-left:auto;width:44px;height:44px;border-radius:10px;border:none;background:none;color:#9a9a9a;cursor:pointer;"><i class="pi pi-times"></i></button></div>
          <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
            <sc-for list="{{ railList }}" as="s" hint-placeholder-count="8">
              <button onClick="{{ s.onClick }}" style="display:flex;align-items:center;gap:9px;padding:11px 10px;border-radius:10px;background:{{ s.bg }};border:1px solid {{ s.bc }};cursor:pointer;font-family:inherit;text-align:left;width:100%;">
                <span style="flex:1;min-width:0;display:block;font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:{{ s.nameC }};">{{ s.name }}</span>
                <span style="font-size:11px;color:#9a9a9a;white-space:nowrap;">{{ s.meta }}</span>
              </button>
            </sc-for>
          </div>
        </div>
      </sc-if>
      <div style="position:absolute;left:50%;transform:translateX(-50%);bottom:14px;background:#1a1a1a;color:#c9c7c2;font-size:11.5px;border-radius:999px;padding:8px 16px;box-shadow:0 8px 24px rgba(0,0,0,0.25);white-space:nowrap;"><i class="pi pi-mobile" style="font-size:11px;margin-right:6px;"></i>Rotate to landscape to practice on the roll</div>
    </div>
  </sc-if>

  <!-- ═══════ PHONE · LANDSCAPE (roll only) ═══════ -->
  <sc-if value="{{ isPhoneL }}" hint-placeholder-val="{{ false }}">
    <div data-screen-label="Phone landscape" style="flex:1;min-height:0;position:relative;background:#fff;overflow:hidden;" onClick="{{ onChrome }}">
      <div style="position:absolute;top:0;left:0;right:0;bottom:44px;display:flex;">
        <div style="width:44px;border-right:1px solid #eeede9;background:#fcfcfb;flex-shrink:0;display:flex;flex-direction:column;z-index:2;">
          <sc-for list="{{ axisRows }}" as="r" hint-placeholder-count="8">
            <div style="flex:1 1 0;display:flex;align-items:center;justify-content:center;border-left:3px solid {{ r.edge }};border-bottom:1px solid #eeede9;background:{{ r.bg }};">
              <b style="font-size:clamp(11px,2.6vh,15px);font-weight:800;color:{{ r.jpC }};">{{ r.big }}</b>
            </div>
          </sc-for>
        </div>
        <div style="position:relative;flex:1;min-width:0;overflow:hidden;">
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;">
            <sc-for list="{{ rollRows }}" as="rr" hint-placeholder-count="8"><i style="flex:1 1 0;border-bottom:1px solid #eeede9;background:{{ rr.bg }};display:block;"></i></sc-for>
          </div>
          <div style="position:absolute;top:0;bottom:0;left:0;width:3800px;transform:{{ laneTxPhone }};">
            <sc-for list="{{ barlines }}" as="b" hint-placeholder-count="4">
              <div style="position:absolute;top:0;bottom:0;width:1px;background:#efeeeb;left:{{ b.x }}px;"></div>
            </sc-for>
            <sc-for list="{{ laneNotesPhone }}" as="n" hint-placeholder-count="10">
              <div style="position:absolute;border-radius:999px;display:flex;align-items:center;padding:0 9px;font-size:12px;font-weight:700;transform:translateY(-50%);height:26px;white-space:nowrap;left:{{ n.x }}px;width:{{ n.w }}px;top:{{ n.top }};background:{{ n.bg }};border:{{ n.border }};color:{{ n.color }};box-shadow:{{ n.shadow }};z-index:{{ n.z }};">
                <span style="overflow:hidden;text-overflow:ellipsis;">{{ n.label }}</span>
              </div>
            </sc-for>
          </div>
          <div style="position:absolute;top:0;bottom:0;left:90px;width:2px;background:#ef4444;z-index:4;box-shadow:0 0 14px rgba(239,68,68,0.45);pointer-events:none;"></div>
        </div>
      </div>
      <!-- karaoke band (always visible) -->
      <div style="position:absolute;left:0;right:0;bottom:0;height:44px;background:#1a1a1a;display:flex;align-items:center;gap:14px;padding:0 14px;z-index:5;">
        <span style="font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8a8a8a;flex-shrink:0;">Lyrics</span>
        <div style="flex:1;display:flex;align-items:baseline;justify-content:center;gap:14px;overflow:hidden;">
          <sc-for list="{{ kWinPhone }}" as="k" hint-placeholder-count="6">
            <span style="font-size:{{ k.size }}px;font-weight:{{ k.weight }};color:{{ k.color }};line-height:1.1;flex-shrink:0;">{{ k.t }}</span>
          </sc-for>
        </div>
        <span style="font-size:10.5px;font-weight:700;color:#f87171;flex-shrink:0;">{{ locLabel }}</span>
      </div>
      <sc-if value="{{ chromeOn }}" hint-placeholder-val="{{ true }}">
        <div onClick="{{ onSwallow }}" style="position:absolute;top:8px;left:54px;right:8px;z-index:6;display:flex;align-items:center;gap:7px;">
          <button onClick="{{ onPhoneNav }}" title="Back to the app" style="display:inline-flex;align-items:center;gap:6px;background:rgba(26,26,26,0.85);color:#fff;font-size:11.5px;font-weight:700;border:none;border-radius:999px;padding:8px 13px;white-space:nowrap;cursor:pointer;font-family:inherit;"><i class="pi pi-arrow-left" style="font-size:10px;"></i> Exit</button>
          <span style="background:rgba(26,26,26,0.85);color:#fff;font-size:11.5px;font-weight:700;border-radius:999px;padding:8px 13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">左手指月 · <span style="color:#f87171;">1=F</span></span>
          <div style="flex:1;"></div>
          <button onClick="{{ onRailStop }}" title="Scores &amp; folders" style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.94);border:1px solid #e5e4e1;color:#5c5c5c;font-size:11.5px;font-weight:700;border-radius:999px;padding:8px 12px;white-space:nowrap;cursor:pointer;font-family:inherit;"><i class="pi pi-folder" style="font-size:11px;"></i> Scores</button>
          <button onClick="{{ onImportStop }}" title="AI convert" style="display:inline-flex;align-items:center;gap:6px;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;font-size:11.5px;font-weight:700;border-radius:999px;padding:8px 12px;white-space:nowrap;cursor:pointer;font-family:inherit;"><i class="pi pi-sparkles" style="font-size:11px;"></i> AI</button>
        </div>
        <div onClick="{{ onSwallow }}" style="position:absolute;left:50%;transform:translateX(-50%);bottom:52px;z-index:6;display:inline-flex;align-items:center;gap:8px;background:rgba(26,26,26,0.92);border-radius:999px;padding:6px 12px;box-shadow:0 8px 28px rgba(0,0,0,0.3);max-width:calc(100% - 16px);">
          <button onClick="{{ onPrev }}" style="width:40px;height:40px;border-radius:999px;border:none;background:none;color:#d4d4d4;cursor:pointer;flex-shrink:0;"><i class="pi pi-chevron-left" style="font-size:13px;"></i></button>
          <button onClick="{{ onPlay }}" style="width:48px;height:48px;border-radius:999px;background:#ef4444;color:#fff;border:none;box-shadow:0 3px 12px rgba(239,68,68,0.5);cursor:pointer;flex-shrink:0;"><i class="{{ playIcon }}" style="font-size:16px;"></i></button>
          <button onClick="{{ onNext }}" style="width:40px;height:40px;border-radius:999px;border:none;background:none;color:#d4d4d4;cursor:pointer;flex-shrink:0;"><i class="pi pi-chevron-right" style="font-size:13px;"></i></button>
          <span style="width:1px;height:22px;background:rgba(255,255,255,0.15);flex-shrink:0;"></span>
          <span style="font-family:ui-monospace,Menlo,monospace;font-size:11.5px;font-weight:600;color:#d4d4d4;white-space:nowrap;">{{ posLabel }}</span>
          <span style="width:1px;height:22px;background:rgba(255,255,255,0.15);flex-shrink:0;"></span>
          <span style="display:inline-flex;align-items:baseline;gap:3px;white-space:nowrap;color:#fff;"><b style="font-size:14px;">{{ bpm }}</b><span style="font-size:8.5px;font-weight:700;color:#8a8a8a;">BPM</span></span>
          <input type="range" min="40" max="160" value="{{ bpm }}" onChange="{{ onBpm }}" style="width:64px;flex-shrink:0;">
          <span style="width:1px;height:22px;background:rgba(255,255,255,0.15);flex-shrink:0;"></span>
          <button onClick="{{ onMetro }}" title="Metronome" style="width:34px;height:34px;border-radius:999px;border:none;background:{{ metroPhBg }};color:{{ metroPhC }};display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;"><svg width="13" height="13" viewBox="0 0 12 12" style="display:block;"><path d="M4.2 1.5 L7.8 1.5 L10 10.5 L2 10.5 Z" style="fill:none;stroke:currentColor;stroke-width:1.3;stroke-linejoin:round;"></path><line x1="6" y1="8.6" x2="8.8" y2="2.6" style="stroke:currentColor;stroke-width:1.3;stroke-linecap:round;"></line></svg></button>
          <button onClick="{{ onReverb }}" title="Reverb" style="width:34px;height:34px;border-radius:999px;border:none;background:{{ revPhBg }};color:{{ revPhC }};display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;"><i class="pi pi-wifi" style="font-size:12px;transform:rotate(90deg);"></i></button>
          <button onClick="{{ onMic }}" title="Mic detect" style="width:34px;height:34px;border-radius:999px;border:none;background:{{ micPhBg }};color:{{ micPhC }};display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;"><i class="pi pi-microphone" style="font-size:12px;"></i></button>
        </div>
      </sc-if>
      <!-- scores overlay (landscape) -->
      <sc-if value="{{ railOpen }}" hint-placeholder-val="{{ false }}">
        <div onClick="{{ onRailStop }}" style="position:absolute;inset:0;z-index:30;background:rgba(26,26,26,0.25);"></div>
        <div onClick="{{ onSwallow }}" style="position:absolute;left:0;top:0;bottom:0;width:290px;z-index:31;background:#fff;box-shadow:8px 0 30px rgba(0,0,0,0.15);display:flex;flex-direction:column;gap:10px;padding:14px 12px;">
          <div style="display:flex;align-items:center;"><b style="font-size:17px;font-weight:800;">Scores</b><button onClick="{{ onRailStop }}" style="margin-left:auto;width:40px;height:40px;border-radius:10px;border:none;background:none;color:#9a9a9a;cursor:pointer;"><i class="pi pi-times"></i></button></div>
          <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
            <sc-for list="{{ railList }}" as="s" hint-placeholder-count="8">
              <button onClick="{{ s.onClick }}" style="display:flex;align-items:center;gap:9px;padding:10px;border-radius:10px;background:{{ s.bg }};border:1px solid {{ s.bc }};cursor:pointer;font-family:inherit;text-align:left;width:100%;">
                <span style="flex:1;min-width:0;display:block;font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:{{ s.nameC }};">{{ s.name }}</span>
                <span style="font-size:10.5px;color:#9a9a9a;white-space:nowrap;">{{ s.meta }}</span>
              </button>
            </sc-for>
          </div>
        </div>
      </sc-if>
      <!-- app nav overlay (exit fullscreen) -->
      <sc-if value="{{ phoneNav }}" hint-placeholder-val="{{ false }}">
        <div onClick="{{ onPhoneNav }}" style="position:absolute;inset:0;z-index:40;background:rgba(26,26,26,0.55);display:flex;align-items:center;justify-content:center;padding:16px;">
          <div onClick="{{ onSwallow }}" style="width:min(440px,100%);max-height:100%;overflow-y:auto;background:#fff;border-radius:16px;box-shadow:0 16px 50px rgba(0,0,0,0.3);padding:16px;">
            <div style="display:flex;align-items:center;margin-bottom:10px;"><b style="font-size:16px;font-weight:800;">Kumquant</b><button onClick="{{ onPhoneNav }}" style="margin-left:auto;width:36px;height:36px;border-radius:9px;border:none;background:none;color:#9a9a9a;cursor:pointer;"><i class="pi pi-times"></i></button></div>
            <div style="display:flex;flex-direction:column;gap:12px;">
              <sc-for list="{{ navGroups }}" as="g" hint-placeholder-count="4">
                <div style="display:flex;flex-direction:column;gap:6px;padding-left:12px;border-left:2px solid {{ g.edge }};">
                  <span style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:{{ g.labC }};">{{ g.label }}</span>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <sc-for list="{{ g.links }}" as="l" hint-placeholder-count="3">
                      <span style="display:flex;align-items:center;gap:7px;padding:8px 13px;border-radius:8px;font-size:13.5px;font-weight:500;color:{{ l.c }};background:{{ l.bgChip }};white-space:nowrap;"><i class="{{ l.icon }}" style="font-size:12px;"></i>{{ l.name }}</span>
                    </sc-for>
                  </div>
                </div>
              </sc-for>
            </div>
          </div>
        </div>
      </sc-if>
    </div>
  </sc-if>

  <!-- ═══════ AI CONVERT MODAL (all layouts) ═══════ -->
  <sc-if value="{{ importOpen }}" hint-placeholder-val="{{ false }}">
    <div data-screen-label="AI convert" style="position:fixed;inset:0;background:rgba(26,26,26,0.35);z-index:130;display:flex;align-items:center;justify-content:center;padding:16px;">
      <div style="width:min(480px,100%);max-height:calc(100vh - 32px);overflow-y:auto;background:#fff;border:1px solid #e5e4e1;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,0.12);">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid #e5e4e1;font-weight:700;font-size:15px;">
          <span><i class="pi pi-plus-circle" style="font-size:13px;margin-right:7px;"></i>Add score</span>
          <button onClick="{{ onImportClose }}" style="width:28px;height:28px;border-radius:7px;border:none;background:none;color:#9a9a9a;font-size:12px;cursor:pointer;"><i class="pi pi-times"></i></button>
        </div>
        <div style="padding:15px 16px;display:flex;flex-direction:column;gap:11px;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <div style="display:inline-flex;border:1px solid #e5e4e1;border-radius:9px;background:#f3f2f0;padding:2px;gap:2px;">
              <button onClick="{{ onTabImg }}" style="padding:6px 13px;border-radius:7px;font-size:12.5px;font-weight:600;color:{{ tabImgC }};background:{{ tabImgBg }};box-shadow:{{ tabImgSh }};display:inline-flex;align-items:center;gap:6px;border:none;cursor:pointer;font-family:inherit;"><i class="pi pi-image" style="font-size:11px;"></i> Picture</button>
              <button onClick="{{ onTabMan }}" style="padding:6px 13px;border-radius:7px;font-size:12.5px;font-weight:600;color:{{ tabManC }};background:{{ tabManBg }};box-shadow:{{ tabManSh }};display:inline-flex;align-items:center;gap:6px;border:none;cursor:pointer;font-family:inherit;"><i class="pi pi-pencil" style="font-size:11px;"></i> Manual</button>
            </div>
            <sc-if value="{{ tabIsImg }}" hint-placeholder-val="{{ true }}">
              <div style="display:inline-flex;flex:1;min-width:150px;border:1px solid #e5e4e1;border-radius:9px;background:#f3f2f0;padding:2px;gap:2px;">
                <button onClick="{{ onSrcJp }}" style="flex:1;padding:6px 8px;border-radius:7px;font-size:12.5px;font-weight:600;color:{{ srcJpC }};background:{{ srcJpBg }};box-shadow:{{ srcJpSh }};border:none;cursor:pointer;font-family:inherit;white-space:nowrap;"># Jianpu</button>
                <button onClick="{{ onSrcWe }}" style="flex:1;padding:6px 8px;border-radius:7px;font-size:12.5px;font-weight:600;color:{{ srcWeC }};background:{{ srcWeBg }};box-shadow:{{ srcWeSh }};border:none;cursor:pointer;font-family:inherit;white-space:nowrap;">Western staff</button>
              </div>
            </sc-if>
          </div>
          <sc-if value="{{ tabIsImg }}" hint-placeholder-val="{{ true }}">
            <div style="border:1.5px dashed #e5e4e1;border-radius:11px;padding:22px 14px;text-align:center;background:#f3f2f0;color:#5c5c5c;font-size:13px;line-height:1.55;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;">
              <i class="pi pi-cloud-upload" style="font-size:21px;color:#9a9a9a;"></i>
              <div>Drop a photo of {{ srcWord }}<br><b>click to browse</b> · or paste from clipboard</div>
            </div>
            <div style="display:flex;gap:9px;">
              <label style="flex:1;display:flex;flex-direction:column;gap:4px;min-width:0;"><span style="font-size:11.5px;font-weight:600;color:#5c5c5c;">Model</span>
                <select style="height:36px;border:1px solid #e5e4e1;border-radius:8px;padding:0 8px;outline:none;background:#fff;font-family:inherit;font-size:13px;color:inherit;min-width:0;"><option>Gemini 3.5 Flash Lite · faster &amp; cheaper</option><option>Grok 4.5 · accurate</option></select>
              </label>
              <label style="flex:0 0 96px;display:flex;flex-direction:column;gap:4px;"><span style="font-size:11.5px;font-weight:600;color:#5c5c5c;">Effort</span>
                <select style="height:36px;border:1px solid #e5e4e1;border-radius:8px;padding:0 8px;outline:none;background:#fff;font-family:inherit;font-size:13px;color:inherit;min-width:0;"><option>High</option><option>Medium</option><option>Low</option></select>
              </label>
            </div>
            <div style="display:flex;gap:18px;flex-wrap:wrap;">
              <button onClick="{{ onCkLyrics }}" style="display:flex;align-items:center;gap:8px;border:none;background:none;padding:0;cursor:pointer;font-family:inherit;">
                <span style="width:18px;height:18px;border-radius:5px;border:1.5px solid {{ ckLyBc }};background:{{ ckLyBg }};display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:8px;"><i class="pi pi-check" style="opacity:{{ ckLyOp }};"></i></span>
                <span style="font-size:13px;font-weight:600;color:#1a1a1a;">Extract lyrics</span>
              </button>
              <button onClick="{{ onCkPinyin }}" style="display:flex;align-items:center;gap:8px;border:none;background:none;padding:0;cursor:pointer;font-family:inherit;">
                <span style="width:18px;height:18px;border-radius:5px;border:1.5px solid {{ ckPyBc }};background:{{ ckPyBg }};display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:8px;"><i class="pi pi-check" style="opacity:{{ ckPyOp }};"></i></span>
                <span style="font-size:13px;font-weight:600;color:#1a1a1a;">+ Pīnyīn</span>
                <span style="font-size:11px;color:#9a9a9a;">romanized syllables</span>
              </button>
            </div>
            <label style="display:flex;flex-direction:column;gap:4px;">
              <span style="font-size:11.5px;font-weight:600;color:#5c5c5c;">Notes for the AI <span style="font-weight:500;color:#9a9a9a;">(optional)</span></span>
              <textarea rows="2" placeholder="e.g. “only transcribe the top voice” · “the repeat sign means play lines 1–2 twice” · “ignore the guitar chords”" style="border:1px solid #fecaca;border-radius:8px;padding:8px 10px;background:#fffcf7;font-size:13px;font-family:inherit;color:inherit;line-height:1.5;outline:none;resize:vertical;"></textarea>
            </label>
          </sc-if>
          <sc-if value="{{ tabIsMan }}" hint-placeholder-val="{{ false }}">
            <textarea rows="6" spellcheck="false" placeholder="1=F 4/4 bpm=80&#10;5, 6, 1 2 | 3 - 5 3&#10;1 2 3 5 | 6' 5 3 1" style="border:1px solid #e5e4e1;border-radius:9px;padding:9px 11px;background:#fffcf7;font-size:13px;font-family:ui-monospace,Menlo,monospace;color:inherit;line-height:1.7;outline:none;resize:vertical;"></textarea>
            <div style="font-size:11.5px;color:#9a9a9a;line-height:1.5;">One text line per printed line. <b>5'</b> high dot · <b>5,</b> low dot · <b>-</b> extends a beat · <b>5_</b> half beat · <b>5.</b> dotted · <b>0</b> rest · <b>|</b> ignored.</div>
          </sc-if>
          <div style="display:flex;gap:9px;">
            <label style="flex:1;display:flex;flex-direction:column;gap:4px;min-width:0;"><span style="font-size:11.5px;font-weight:600;color:#5c5c5c;">Score name <span style="font-weight:500;color:#9a9a9a;">(AI fills it in)</span></span>
              <input type="text" placeholder="e.g. 美丽的金孔雀" style="height:36px;border:1px solid #e5e4e1;border-radius:8px;padding:0 10px;outline:none;background:#fff;font-family:inherit;font-size:13px;color:inherit;min-width:0;">
            </label>
            <label style="flex:0 0 128px;display:flex;flex-direction:column;gap:4px;"><span style="font-size:11.5px;font-weight:600;color:#5c5c5c;">Folder</span>
              <select style="height:36px;border:1px solid #e5e4e1;border-radius:8px;padding:0 8px;outline:none;background:#fff;font-family:inherit;font-size:13px;color:inherit;min-width:0;"><option>No folder</option><option>good ones</option></select>
            </label>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:11px 16px;border-top:1px solid #e5e4e1;">
          <span style="font-size:11px;color:#5c5c5c;display:inline-flex;align-items:center;gap:5px;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;"><i class="pi pi-bolt" style="color:#b91c1c;"></i> Opens as it transcribes.</span>
          <div style="flex:1;"></div>
          <button onClick="{{ onImportClose }}" style="height:36px;padding:0 13px;border-radius:9px;font-size:13px;color:#5c5c5c;border:1px solid #e5e4e1;background:#fff;font-weight:500;cursor:pointer;font-family:inherit;white-space:nowrap;">Cancel</button>
          <button style="display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 15px;border-radius:9px;background:#ef4444;color:#fff;font-size:13px;font-weight:600;box-shadow:0 2px 8px rgba(239,68,68,0.25);border:none;opacity:0.45;cursor:not-allowed;font-family:inherit;white-space:nowrap;"><i class="pi pi-sparkles" style="font-size:12px;"></i> {{ primaryLabel }}</button>
        </div>
      </div>
    </div>
  </sc-if>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props="{&quot;forceLayout&quot;:{&quot;editor&quot;:&quot;enum&quot;,&quot;options&quot;:[&quot;auto&quot;,&quot;desktop&quot;,&quot;phone-portrait&quot;,&quot;phone-landscape&quot;],&quot;default&quot;:&quot;auto&quot;,&quot;tsType&quot;:&quot;string&quot;,&quot;section&quot;:&quot;Layout&quot;},&quot;lyricsScript&quot;:{&quot;editor&quot;:&quot;enum&quot;,&quot;options&quot;:[&quot;chinese&quot;,&quot;pinyin&quot;],&quot;default&quot;:&quot;chinese&quot;,&quot;tsType&quot;:&quot;string&quot;,&quot;section&quot;:&quot;Lyrics&quot;},&quot;lyricsPosition&quot;:{&quot;editor&quot;:&quot;enum&quot;,&quot;options&quot;:[&quot;band&quot;,&quot;notes&quot;],&quot;default&quot;:&quot;band&quot;,&quot;tsType&quot;:&quot;string&quot;,&quot;section&quot;:&quot;Lyrics&quot;}}">
class Component extends DCLogic {
  constructor(props) {
    super(props);
    const ZH = '山水云月风花雪夜春江潮海天光影歌声远近高低回望流转起落'.split('');
    const PY = ['shān','shuǐ','yún','yuè','fēng','huā','xuě','yè','chūn','jiāng','cháo','hǎi','tiān','guāng','yǐng','gē','shēng','yuǎn','jìn','gāo','dī','huí','wàng','liú','zhuǎn','qǐ','luò'];
    this.ZH = ZH; this.PY = PY;
    const raw = [
      [4, 22.55, 1.3, '1'], [5, 23.6, 0.45, '7'], [6, 24.0, 0.6, '6'],
      [4, 25.45, 0.5, '1'], [2, 26.9, 1.3, '2'], [4, 27.75, 0.5, '1'],
      [3, 28.6, 2.0, '3'], [2, 30.7, 0.5, '2'],
      [6, 32.9, 0.5, '6'], [1, 33.6, 0.5, '5'], [7, 34.2, 0.5, '5'],
      [0, 35.0, 0.5, '6'], [0, 35.6, 0.5, '6'], [6, 36.3, 0.5, '6'],
      [7, 37.0, 1.7, '5', 1], [1, 39.0, 0.5, '5'],
      [3, 40.85, 0.5, '3'], [2, 41.5, 0.5, '2'], [6, 42.2, 0.5, '6'],
      [0, 44.55, 0.5, '6'], [0, 45.75, 1.9, '7', 1], [0, 47.85, 0.5, '6'],
      [0, 48.95, 1.8, '2', 1], [7, 51.0, 0.5, '5'],
      [0, 52.4, 0.5, '6'], [0, 53.55, 1.7, '1', 1], [0, 55.6, 0.5, '6'],
      [0, 56.7, 1.6, '2', 1], [0, 59.0, 0.5, '1'], [0, 60.7, 1.9, '3', 1],
    ];
    this._nextId = 0;
    const notes = raw.map(([row, start, beats, label, warn], i) => ({
      id: this._nextId++, row, start, beats, label, warn: !!warn, zi: ZH[i % ZH.length], pi: PY[i % PY.length],
    }));
    this.state = {
      vw: typeof window !== 'undefined' ? window.innerWidth : 1600,
      vh: typeof window !== 'undefined' ? window.innerHeight : 900,
      mode: 'listen', playing: false, t: 24, bpm: 73,
      notes, history: [], clipboard: null, selIds: [], selBars: [], cursorT: 24,
      railOpen: false, tunerOpen: false, importOpen: false, chromeOn: true,
      lyricsOn: true, script: null, lyricsPos: null,
      notation: 'jianpu', scoreView: 'jianpu', keySel: 'F',
      metroOn: true, reverbOn: false, micOn: false, reverbLevel: 50,
      picZoom: 1, phoneNav: false, marquee: null,
      importTab: 'image', importSrc: 'jianpu', ckLyrics: true, ckPinyin: true,
      activeScore: 0, cents: -6,
    };
  }

  componentDidMount() {
    this._onResize = () => this.setState({ vw: window.innerWidth, vh: window.innerHeight });
    window.addEventListener('resize', this._onResize);
    this._onKey = (e) => this.handleKey(e);
    window.addEventListener('keydown', this._onKey);
    this._raf = 0; this._last = 0;
    const frame = (ts) => {
      this._raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (ts - this._last) / 1000 || 0);
      this._last = ts;
      if (this.state.playing) {
        let t = this.state.t + dt * (this.state.bpm / 60);
        if (t > 63) t = 22;
        this.setState({ t });
      }
      if (this.state.tunerOpen && ts - (this._lastCents || 0) > 240) {
        this._lastCents = ts;
        const c = Math.max(-14, Math.min(6, this.state.cents + (Math.random() * 6 - 3)));
        this.setState({ cents: Math.round(c * 10) / 10 });
      }
    };
    this._raf = requestAnimationFrame(frame);
  }
  componentWillUnmount() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onKey);
    cancelAnimationFrame(this._raf);
  }

  pushHistory() { this.setState({ history: [...this.state.history, this.state.notes.map((n) => ({ ...n }))].slice(-30) }); }
  sorted() { return [...this.state.notes].sort((a, b) => a.start - b.start); }
  curIdx() { const s = this.sorted(); let i = -1; for (let k = 0; k < s.length; k++) if (s[k].start <= this.state.t) i = k; return { i, s }; }

  handleKey(e) {
    const editMode = this.state.mode === 'edit';
    if (e.key === ' ' && !editMode && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); this.setState({ playing: !this.state.playing }); return; }
    if (!editMode || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const sel = this.state.notes.filter((n) => this.state.selIds.includes(n.id));
    if (/^[1-7]$/.test(e.key)) {
      e.preventDefault(); this.pushHistory();
      const ROW = { 1: 4, 2: 3, 3: 2, 4: 2, 5: 1, 6: 6, 7: 5 };
      const zi = this.ZH[this.state.notes.length % this.ZH.length];
      const pi = this.PY[this.state.notes.length % this.PY.length];
      const note = { id: this._nextId++, row: ROW[e.key], start: this.state.cursorT, beats: 0.5, label: e.key, warn: false, zi, pi };
      this.setState({ notes: [...this.state.notes, note], cursorT: this.state.cursorT + 0.5, selIds: [note.id] });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!sel.length) return;
      e.preventDefault(); this.pushHistory();
      this.setState({ notes: this.state.notes.filter((n) => !this.state.selIds.includes(n.id)), selIds: [] });
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!sel.length) return;
      e.preventDefault(); this.pushHistory();
      const d = e.key === 'ArrowUp' ? -1 : 1;
      this.mutateSel((n) => ({ ...n, row: Math.max(0, Math.min(7, n.row + d)) }));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (!sel.length) return;
      e.preventDefault(); this.pushHistory();
      const d = e.key === 'ArrowRight' ? 0.25 : -0.25;
      this.mutateSel((n) => ({ ...n, beats: Math.max(0.25, n.beats + d) }));
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      e.preventDefault(); this.copySel();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
      e.preventDefault(); this.pasteSel();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault(); this.undo();
    }
  }

  onRollDown(e) {
    if (this.state.mode !== 'edit' || e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    this._mqRect = r;
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    const x = e.clientX - r.left, y = e.clientY - r.top;
    this.setState({ marquee: { x0: x, y0: y, x1: x, y1: y } });
  }
  onRollMove(e) {
    if (!this.state.marquee || !this._mqRect) return;
    const r = this._mqRect;
    this.setState({ marquee: { ...this.state.marquee, x1: e.clientX - r.left, y1: e.clientY - r.top } });
  }
  onRollUp() {
    const mq = this.state.marquee, r = this._mqRect;
    if (!mq || !r) { this.setState({ marquee: null }); return; }
    const w = Math.abs(mq.x1 - mq.x0), h = Math.abs(mq.y1 - mq.y0);
    if (w < 5 && h < 5) { this.setState({ marquee: null, selIds: [] }); return; }
    const PX = 56, laneOff = 168 - this.state.t * PX;
    const b0 = (Math.min(mq.x0, mq.x1) - laneOff) / PX, b1 = (Math.max(mq.x0, mq.x1) - laneOff) / PX;
    const r0 = Math.floor(Math.min(mq.y0, mq.y1) / r.height * 8), r1 = Math.floor(Math.max(mq.y0, mq.y1) / r.height * 8);
    const ids = this.state.notes.filter((n) => n.start < b1 && n.start + n.beats > b0 && n.row >= r0 && n.row <= r1).map((n) => n.id);
    this.setState({ marquee: null, selIds: ids });
  }
  mutateSel(fn) { this.setState({ notes: this.state.notes.map((n) => (this.state.selIds.includes(n.id) ? fn(n) : n)) }); }
  copySel() {
    const sel = this.state.notes.filter((n) => this.state.selIds.includes(n.id));
    if (sel.length) this.setState({ clipboard: sel.map((n) => ({ ...n })) });
  }
  pasteSel() {
    const clip = this.state.clipboard;
    if (!clip || !clip.length) return;
    this.pushHistory();
    const min = Math.min(...clip.map((n) => n.start));
    const at = this.state.cursorT;
    const pasted = clip.map((n) => ({ ...n, id: this._nextId++, start: n.start - min + at }));
    const end = Math.max(...pasted.map((n) => n.start + n.beats));
    this.setState({ notes: [...this.state.notes, ...pasted], selIds: pasted.map((n) => n.id), cursorT: end });
  }
  undo() {
    const h = this.state.history;
    if (!h.length) return;
    this.setState({ notes: h[h.length - 1], history: h.slice(0, -1), selIds: [] });
  }

  renderVals() {
    const st = this.state;
    const force = this.props.forceLayout ?? 'auto';
    let layout;
    if (force !== 'auto') layout = force;
    else if (st.vw > st.vh && st.vh < 500) layout = 'phone-landscape';
    else if (st.vw < 900) layout = st.vw > st.vh ? 'phone-landscape' : 'phone-portrait';
    else layout = 'desktop';
    const isDesktop = layout === 'desktop', isPhoneP = layout === 'phone-portrait', isPhoneL = layout === 'phone-landscape';

    const script = st.script ?? this.props.lyricsScript ?? 'chinese';
    const py = script === 'pinyin';
    const lyricsPos = st.lyricsPos ?? this.props.lyricsPosition ?? 'band';
    const editMode = st.mode === 'edit';

    const on = (bg, c, bc, sh) => ({ bg, c, bc, sh });
    const seg = (active) => active
      ? { c: '#b91c1c', bg: '#fff', sh: '0 1px 2px rgba(0,0,0,0.08)' }
      : { c: '#5c5c5c', bg: 'transparent', sh: 'none' };

    // nav
    const link = (icon, name, act) => ({ icon: 'pi ' + icon, name, c: act ? '#b91c1c' : '#4b5563', bg: act ? '#fee2e2' : 'transparent', bgChip: act ? '#fee2e2' : '#f3f2f0' });
    const navGroups = [
      { label: 'Scraper', edge: '#f97316', labC: '#fb923c', links: [link('pi-home', 'Home'), link('pi-chart-bar', 'Dashboard'), link('pi-database', 'Database')] },
      { label: 'Sensors', edge: '#22c55e', labC: '#4ade80', links: [link('pi-sun', 'Weather'), link('pi-server', 'Monitor')] },
      { label: 'Productivity', edge: '#a855f7', labC: '#c084fc', links: [link('pi-file-edit', 'Notes'), link('pi-bell', 'Reminders'), link('pi-camera', 'Documents')] },
      { label: 'Tools', edge: '#ef4444', labC: '#f87171', links: [link('pi-microchip', 'Breadly'), link('pi-database', 'Diffy'), link('pi-clone', 'Canvy'), link('pi-headphones', 'Bawu', true)] },
    ];

    // axis
    const BAWU = [
      { jp: '6', pitch: 'D5', holes: [0,0,0,0,0,0,0] }, { jp: '5', pitch: 'C5', holes: [1,0,0,0,0,0,0] },
      { jp: '3', pitch: 'A4', holes: [1,1,0,0,0,0,0] }, { jp: '2', pitch: 'G4', holes: [1,1,1,0,0,0,0] },
      { jp: '1', pitch: 'F4', holes: [1,1,1,1,0,0,0] }, { jp: '7̣', pitch: 'E4', holes: [1,1,1,1,1,0,0] },
      { jp: '6̣', pitch: 'D4', holes: [1,1,1,1,1,1,0] }, { jp: '5̣', pitch: 'C4', holes: [1,1,1,1,1,1,1] },
    ];
    const { i: curI, s: sortedNotes } = this.curIdx();
    const curNote = sortedNotes[Math.max(0, curI)] || null;
    const curRow = curNote ? curNote.row : 6;
    const western = st.notation === 'western';
    const axisRows = BAWU.map((n, i) => {
      const a = i === curRow;
      const r = {
        big: western ? n.pitch : n.jp, small: western ? n.jp : n.pitch,
        jpC: a ? '#b91c1c' : '#1a1a1a', pC: a ? '#b91c1c' : '#9a9a9a',
        edge: a ? '#ef4444' : 'transparent',
        bg: a ? '#fef2f2' : (i % 2 === 1 ? 'rgba(243,242,240,0.65)' : 'transparent'),
      };
      n.holes.forEach((h, hi) => { r['h' + hi + 'bc'] = h ? (a ? '#ef4444' : '#1a1a1a') : '#a8a29e'; r['h' + hi + 'bg'] = h ? (a ? '#ef4444' : '#1a1a1a') : 'transparent'; });
      return r;
    });
    const rollRows = BAWU.map((n, i) => ({ bg: i === curRow ? 'rgba(239,68,68,0.05)' : (i % 2 === 1 ? 'rgba(243,242,240,0.5)' : 'transparent') }));

    // lane
    const PX = 56;
    const barlines = []; for (let b = 1; b <= 16; b++) barlines.push({ n: b, x: (b - 1) * 4 * PX });
    const WEST = ['D5','C5','A4','G4','F4','E4','D4','C4'];
    const mkNote = (n, phone) => {
      const isCur = curNote && n.id === curNote.id;
      const done = n.start + n.beats < st.t && !isCur;
      const selected = editMode && st.selIds.includes(n.id);
      const label = western ? WEST[n.row] : n.label;
      const syl = (!editMode && st.lyricsOn && lyricsPos === 'notes' && !phone) ? (py ? n.pi : n.zi) : '';
      const base = {
        x: n.start * PX, w: Math.max(30, n.beats * PX - 6), top: `${(n.row + 0.5) * 12.5}%`,
        label, syl, warn: n.warn, z: 1, shadow: 'none', outline: 'none',
        handle: editMode, cursor: editMode ? 'pointer' : 'default',
        title: editMode ? 'Click to select · drag empty space to select many' : '',
        onDown: editMode ? (e) => e.stopPropagation() : undefined,
        onClick: editMode ? (e) => { e.stopPropagation(); const has = st.selIds.includes(n.id); this.setState({ selIds: e.shiftKey ? (has ? st.selIds.filter((x) => x !== n.id) : [...st.selIds, n.id]) : [n.id] }); } : undefined,
      };
      if (isCur) return { ...base, bg: '#ef4444', border: 'none', color: '#fff', shadow: '0 3px 12px rgba(239,68,68,0.4)', z: 3 };
      if (selected) return { ...base, bg: '#fef2f2', border: '1.5px solid #ef4444', color: '#b91c1c', outline: '2px solid rgba(239,68,68,0.6)', z: 5 };
      if (done) return { ...base, bg: '#bbf7d0', border: '1px solid #86efac', color: '#166534' };
      if (n.warn) return { ...base, bg: '#fffbeb', border: editMode ? '1.5px solid #d97706' : '1.5px dashed #d97706', color: '#d97706' };
      return { ...base, bg: '#fff', border: '1.5px solid #d6d4d0', color: '#44403c' };
    };
    const laneNotes = sortedNotes.map((n) => mkNote(n, false));
    const laneNotesPhone = sortedNotes.map((n) => mkNote(n, true));
    const laneTx = `translateX(${168 - st.t * PX}px)`;
    const laneTxPhone = `translateX(${90 - st.t * PX}px)`;

    // marquee (window select), in roll coordinates
    const mq = st.marquee;
    const mqOn = !!mq && (Math.abs(mq.x1 - mq.x0) > 4 || Math.abs(mq.y1 - mq.y0) > 4);
    const mqX = mq ? Math.min(mq.x0, mq.x1) : 0, mqY = mq ? Math.min(mq.y0, mq.y1) : 0;
    const mqW = mq ? Math.abs(mq.x1 - mq.x0) : 0, mqH = mq ? Math.abs(mq.y1 - mq.y0) : 0;

    // karaoke
    const kWin = [];
    for (let k = Math.max(0, curI - 2); k < Math.min(sortedNotes.length, curI + 5); k++) {
      const n = sortedNotes[k];
      const cur = k === curI;
      kWin.push({
        t: py ? n.pi : n.zi, sub: py ? n.zi : n.pi,
        size: cur ? 34 : 19, weight: cur ? 800 : 500,
        color: k < curI ? '#5a5a5a' : cur ? '#f87171' : '#d4d4d4',
        subC: cur ? '#f87171' : '#6a6a6a',
      });
    }
    const kWinPhone = [];
    for (let k = Math.max(0, curI - 1); k < Math.min(sortedNotes.length, curI + 6); k++) {
      const n = sortedNotes[k];
      const cur = k === curI;
      kWinPhone.push({
        t: py ? n.pi : n.zi,
        size: cur ? 21 : 14, weight: cur ? 800 : 500,
        color: k < curI ? '#5a5a5a' : cur ? '#f87171' : '#d4d4d4',
      });
    }
    const curSylBig = curNote ? (py ? curNote.pi : curNote.zi) : '';
    const nextSyls = sortedNotes.slice(curI + 1, curI + 5).map((n) => (py ? n.pi : n.zi)).join('  ');

    // modes
    const modes = [
      { id: 'follow', name: 'Follow me', icon: 'pi pi-microphone' },
      { id: 'steady', name: 'Steady', icon: 'pi pi-stopwatch' },
      { id: 'listen', name: 'Listen', icon: 'pi pi-volume-up' },
    ];
    const modeSeg = modes.map((m) => {
      const act = st.mode === m.id;
      return { ...m, c: act ? '#fff' : '#5c5c5c', bg: act ? '#ef4444' : 'transparent', sh: act ? '0 2px 8px rgba(239,68,68,0.4)' : 'none', onClick: () => this.setState({ mode: m.id, playing: false }) };
    });
    const modeHints = {
      follow: 'The song waits for your bawu — hold the target note to advance · Space steps manually',
      steady: `Scrolls at ${st.bpm} BPM with the metronome — play along`,
      listen: `Synth plays the piece at ${st.bpm} BPM — listen and follow the fingering`,
      edit: '',
    };

    // jianpu sheet
    let li = 0;
    const syl = () => { const i = (li++) % this.ZH.length; return py ? this.PY[i] : this.ZH[i]; };
    const mk = (d, o = {}) => ({ d, u1: o.u ? '1.5px solid currentColor' : 'none', hi: !!o.hi, lo: !!o.lo, dash: o.dash || '', ly: o.noly ? '' : syl(), minW: py && !o.noly ? '34px' : '0', bg: 'transparent', outline: 'none', color: '#1a1a1a', lyC: '#5c5c5c' });
    const zone = curI >= 0 ? Math.min(5, Math.floor((st.t - 20) / 8)) : 2;
    const mkLine = (toks, idx) => ({ notes: toks, gap: py ? '8px 6px' : '7px 8px', gapPhone: py ? '12px 8px' : '10px 12px', outline: idx === zone ? '1px dashed #d97706' : 'none', bg: idx === zone ? 'rgba(217,119,6,0.04)' : 'transparent' });
    const jianpuLines = [
      mkLine([mk('6',{u:1}), mk('3',{u:1}), mk('3'), mk('5',{u:1}), mk('6',{u:1}), mk('6',{u:1}), mk('7',{u:1}), mk('6',{u:1}), mk('5',{u:1}), mk('3'), mk('5',{u:1}), mk('3',{dash:'–'}), mk('0',{noly:1})], 0),
      mkLine([mk('2',{u:1}), mk('3',{u:1}), mk('4',{u:1}), mk('5',{u:1}), mk('6',{hi:1}), mk('5',{u:1,hi:1}), mk('6',{u:1,hi:1}), mk('1',{u:1,hi:1}), mk('7'), mk('6',{u:1}), mk('7',{dash:'–'}), mk('6',{u:1}), mk('1',{u:1,hi:1})], 1),
      mkLine([mk('2',{dash:'–'}), mk('2',{u:1}), mk('3',{u:1}), mk('2',{u:1}), mk('6',{u:1}), mk('1',{dash:'–'}), mk('7',{u:1}), mk('1',{dash:'–'}), mk('6',{u:1}), mk('1',{u:1}), mk('2',{dash:'–'}), mk('0',{noly:1}), mk('1',{u:1}), mk('2',{u:1}), mk('4',{u:1})], 2),
      mkLine([mk('3',{dash:'––'}), mk('0',{noly:1}), mk('6',{u:1}), mk('3',{u:1}), mk('3'), mk('5',{u:1}), mk('6',{u:1}), mk('7',{u:1}), mk('6',{u:1}), mk('5',{u:1}), mk('3'), mk('5',{u:1}), mk('3',{dash:'–'}), mk('0',{noly:1})], 3),
      mkLine([mk('1',{hi:1}), mk('7',{u:1}), mk('1',{dash:'–',hi:1}), mk('6',{u:1}), mk('1',{u:1,hi:1}), mk('2',{dash:'–',hi:1}), mk('0',{noly:1}), mk('1',{u:1,hi:1}), mk('2',{u:1,hi:1}), mk('4',{u:1,hi:1}), mk('3',{dash:'––',hi:1})], 4),
      mkLine([mk('6',{u:1}), mk('3',{u:1}), mk('3'), mk('5',{u:1}), mk('6',{u:1}), mk('6',{u:1}), mk('7',{u:1}), mk('6',{u:1}), mk('5',{u:1,noly:1})], 5),
    ];

    // rails
    const scores = [
      ['左手指月 (The Left H…', '1=F · 147 notes', 'now'], ['无羁 (Wuji)', '1=C · 53 notes', '6h'],
      ['渔歌 (Fishing Song)', '1=F · 128 notes', '18h'], ['美丽的神话 (Beautifu…', '1=C · 120 notes', '20h'],
      ['水龙吟 (Shui Long Yin)', '1=C · 253 notes', '20h'], ['大鱼 (Big Fish)', '1=F · 253 notes', '20h'],
      ['星河叹 (Star River Si…', '1=C · 368 notes', '20h'], ['凉凉 (Liang Liang)', '1=C · 104 notes', '20h'],
    ];
    const railList = scores.map(([name, meta, time], i) => {
      const a = i === st.activeScore;
      return { name, meta, time, icon: 'pi pi-image', bg: a ? '#fef2f2' : '#fff', bc: a ? '#ef4444' : '#eeede9', iconBg: a ? '#fff' : '#f3f2f0', iconC: a ? '#b91c1c' : '#5c5c5c', nameC: a ? '#b91c1c' : '#1a1a1a', onClick: () => this.setState({ activeScore: i }) };
    });
    const railIcons = scores.map(([name], i) => {
      const a = i === st.activeScore;
      return { ch: name[0], name, bc: a ? '#ef4444' : '#e5e4e1', bg: a ? '#fef2f2' : '#fff', c: a ? '#b91c1c' : '#5c5c5c', onClick: () => this.setState({ activeScore: i }) };
    });

    // keys
    const keySeg = ['F', 'G', 'C', 'B♭', 'C · adj'].map((k) => {
      const adj = k === 'C · adj';
      const act = st.keySel === k;
      return {
        t: k, fs: adj ? 11.5 : 13,
        border: act ? '1px solid #ef4444' : adj ? '1px dashed #f87171' : '1px solid #e5e4e1',
        bg: act ? '#ef4444' : adj ? '#fef2f2' : '#fff',
        c: act ? '#fff' : adj ? '#b91c1c' : '#1a1a1a',
        onClick: () => this.setState({ keySel: k }),
      };
    });

    // tuner
    const CX = 150, CY = 112, R = 94;
    const ticks = [];
    for (let c = -50; c <= 50; c += 5) {
      const major = c % 25 === 0;
      const a = ((c / 50) * 60 - 90) * (Math.PI / 180);
      const rIn = R - (major ? 15 : 8);
      ticks.push({ x1: CX + Math.cos(a) * rIn, y1: CY + Math.sin(a) * rIn, x2: CX + Math.cos(a) * R, y2: CY + Math.sin(a) * R, stroke: c === 0 ? '#ef4444' : major ? '#8a8781' : '#d6d4d0', w: c === 0 ? 2.5 : major ? 2.25 : 1.5 });
    }
    const a1 = ((-8 / 50) * 60 - 90) * (Math.PI / 180), a2 = ((8 / 50) * 60 - 90) * (Math.PI / 180);
    const pt = (a, r) => `${CX + Math.cos(a) * r} ${CY + Math.sin(a) * r}`;
    const wedge = `M ${pt(a1, 38)} L ${pt(a1, R - 17)} A ${R - 17} ${R - 17} 0 0 1 ${pt(a2, R - 17)} L ${pt(a2, 38)} A 38 38 0 0 0 ${pt(a1, 38)} Z`;
    const inTune = Math.abs(st.cents) <= 8;
    const tunerNoteC = inTune ? '#16a34a' : '#ef4444';
    const needleDeg = (Math.max(-50, Math.min(50, st.cents)) / 50) * 60;
    const centsLabel = (st.cents > 0 ? '+' : '') + st.cents.toFixed(0) + '¢';
    const hzLabel = (293.66 * Math.pow(2, st.cents / 1200)).toFixed(1) + ' Hz';

    // edit derived
    const sel = st.notes.filter((n) => st.selIds.includes(n.id));
    const one = sel.length === 1 ? sel[0] : null;
    const selLabel = sel.length === 0 ? 'Nothing selected — click a note' : sel.length === 1 ? `1 note · bar ${Math.floor(sel[0].start / 4) + 1}` : `${sel.length} notes selected`;
    const degSeg = ['1','2','3','4','5','6','7'].map((d) => {
      const act = sel.length && sel.every((n) => n.label === d);
      return { d, c: act ? '#b91c1c' : '#5c5c5c', bg: act ? '#fff' : 'transparent', sh: act ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
        onClick: () => { if (!sel.length) return; this.pushHistory(); this.mutateSel((n) => ({ ...n, label: d })); } };
    });
    const LENS = [['¼', 0.25], ['½', 0.5], ['¾', 0.75], ['1', 1], ['1½', 1.5], ['2', 2], ['4', 4]];
    const lenSeg = LENS.map(([t, v]) => {
      const act = sel.length && sel.every((n) => Math.abs(n.beats - v) < 0.01);
      return { t, c: act ? '#b91c1c' : '#5c5c5c', bg: act ? '#fff' : 'transparent', sh: act ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
        onClick: () => { if (!sel.length) return; this.pushHistory(); this.mutateSel((n) => ({ ...n, beats: v })); } };
    });
    const chip = (active, activeGreen) => active
      ? (activeGreen ? { bc: 'transparent', c: '#166534', bg: '#dcfce7', sh: 'inset 0 0 0 1px rgba(22,163,74,0.25)' } : { bc: 'transparent', c: '#b91c1c', bg: '#fef2f2', sh: 'inset 0 0 0 1px rgba(239,68,68,0.25)' })
      : { bc: '#e5e4e1', c: '#5c5c5c', bg: '#fff', sh: 'none' };
    const metro = chip(st.metroOn, true), rev = chip(st.reverbOn, true), mic = chip(st.micOn, false), lyr = chip(st.lyricsOn, true);
    const zh = seg(!py), pyS = seg(py), band = seg(lyricsPos === 'band'), notesSeg = seg(lyricsPos === 'notes');
    const notJp = seg(!western), notWe = seg(western);
    const vPic = seg(st.scoreView === 'picture'), vJp = seg(st.scoreView === 'jianpu');
    const tabImg = seg(st.importTab === 'image'), tabMan = seg(st.importTab === 'manual');
    const srcJp = seg(st.importSrc === 'jianpu'), srcWe = seg(st.importSrc === 'western');

    const posLabel = `${Math.max(1, curI + 1)} / ${sortedNotes.length}`;
    const locLabel = `line ${zone + 1} · bar ${Math.floor(st.t / 4) + 1}`;

    return {
      isDesktop, isPhoneP, isPhoneL,
      navGroups, axisRows, rollRows, barlines, laneNotes, laneNotesPhone, laneTx, laneTxPhone,
      karaoke: kWin, curSylBig, nextSyls, jianpuLines, railList, railIcons, keySeg,
      ticks, wedge, needleDeg, tunerNoteC, centsLabel, hzLabel,
      modeSeg, modeHint: modeHints[st.mode] || '', editMode, notEdit: !editMode,
      editSegC: editMode ? '#fff' : '#5c5c5c', editSegBg: editMode ? '#1a1a1a' : 'transparent', editSegSh: editMode ? '0 2px 8px rgba(0,0,0,0.3)' : 'none',
      rollCursor: editMode ? 'crosshair' : 'default',
      showBand: !editMode && st.lyricsOn && lyricsPos === 'band',
      lyricsOn: st.lyricsOn,
      railOpen: st.railOpen, tunerOpen: st.tunerOpen, importOpen: st.importOpen, chromeOn: st.chromeOn,
      railBtnBc: st.railOpen ? '#ef4444' : '#e5e4e1', railBtnBg: st.railOpen ? '#fef2f2' : '#fff', railBtnC: st.railOpen ? '#b91c1c' : '#5c5c5c',
      tunerBtnBc: st.tunerOpen ? '#ef4444' : '#e5e4e1', tunerBtnBg: st.tunerOpen ? '#fef2f2' : '#fff', tunerBtnC: st.tunerOpen ? '#b91c1c' : '#5c5c5c',
      playing: st.playing, playIcon: st.playing ? 'pi pi-pause' : 'pi pi-play', playBg: st.playing ? '#b91c1c' : '#ef4444',
      dockCompact: st.vw < 1350, dockWide: st.vw >= 1350, seekW: st.vw < 1350 ? 90 : 150, bpmW: st.vw < 1350 ? 60 : 84,
      bpm: st.bpm, posLabel, locLabel, seekMax: Math.max(1, sortedNotes.length - 1), seekVal: Math.max(0, curI),
      panelTitle: st.scoreView === 'jianpu' ? 'Transcribed jianpu' : 'Original score',
      showPic: st.scoreView === 'picture', showJp: st.scoreView === 'jianpu',
      mqOn, mqX, mqY, mqW, mqH, degSeg, lenSeg, selLabel,
      jpGap: py ? '8px 6px' : '7px 8px', jpGapPhone: py ? '12px 8px' : '10px 12px',
      kWinPhone, reverbOn: st.reverbOn, reverbLevel: st.reverbLevel,
      picZoom: `scale(${st.picZoom})`, picZoomPct: Math.round(st.picZoom * 100) + '%', phoneNav: st.phoneNav,
      selRowLabel: one ? BAWU[one.row].pitch : '—', selSyl: one ? (py ? one.pi : one.zi) : '',
      selChip: sel.length ? `${sel.length} selected` : '',
      undoC: st.history.length ? '#b91c1c' : '#e5b5b5',
      pasteC: st.clipboard ? '#b91c1c' : '#e5b5b5',
      metroBc: metro.bc, metroC: metro.c, metroBg: metro.bg, metroSh: metro.sh,
      revBc: rev.bc, revC: rev.c, revBg: rev.bg, revSh: rev.sh,
      micBc: mic.bc, micC: mic.c, micBg: mic.bg, micSh: mic.sh,
      lyrBc: lyr.bc, lyrC: lyr.c, lyrBg: lyr.bg, lyrSh: lyr.sh,
      zhC: zh.c, zhBg: zh.bg, zhSh: zh.sh, pyC: pyS.c, pyBg: pyS.bg, pySh: pyS.sh,
      bandC: band.c, bandBg: band.bg, bandSh: band.sh, notesC: notesSeg.c, notesBg: notesSeg.bg, notesSh: notesSeg.sh,
      notJpC: notJp.c, notJpBg: notJp.bg, notJpSh: notJp.sh, notWeC: notWe.c, notWeBg: notWe.bg, notWeSh: notWe.sh,
      vPicC: vPic.c, vPicBg: vPic.bg, vPicSh: vPic.sh, vJpC: vJp.c, vJpBg: vJp.bg, vJpSh: vJp.sh,
      tabImgC: tabImg.c, tabImgBg: tabImg.bg, tabImgSh: tabImg.sh, tabManC: tabMan.c, tabManBg: tabMan.bg, tabManSh: tabMan.sh,
      srcJpC: srcJp.c, srcJpBg: srcJp.bg, srcJpSh: srcJp.sh, srcWeC: srcWe.c, srcWeBg: srcWe.bg, srcWeSh: srcWe.sh,
      tabIsImg: st.importTab === 'image', tabIsMan: st.importTab === 'manual',
      srcWord: st.importSrc === 'western' ? 'western staff notation' : 'jianpu',
      primaryLabel: st.importTab === 'image' ? 'Convert & open' : 'Create score',
      ckLyBc: st.ckLyrics ? '#ef4444' : '#e5e4e1', ckLyBg: st.ckLyrics ? '#ef4444' : '#fff', ckLyOp: st.ckLyrics ? 1 : 0,
      ckPyBc: st.ckPinyin ? '#ef4444' : '#e5e4e1', ckPyBg: st.ckPinyin ? '#ef4444' : '#fff', ckPyOp: st.ckPinyin ? 1 : 0,
      // handlers
      onRail: () => this.setState({ railOpen: !st.railOpen }),
      onTuner: () => this.setState({ tunerOpen: !st.tunerOpen }),
      onImportOpen: () => this.setState({ importOpen: true, railOpen: false }),
      onImportClose: () => this.setState({ importOpen: false }),
      onEdit: () => this.setState({ mode: 'edit', playing: false }),
      onEditDone: () => this.setState({ mode: 'listen', selIds: [], selBars: [] }),
      onPlay: (e) => { if (e) e.stopPropagation(); this.setState({ playing: !st.playing }); },
      onStop: () => this.setState({ playing: false, t: 22 }),
      onStart: () => this.setState({ t: 22 }),
      onPrev: (e) => { if (e) e.stopPropagation(); const i = Math.max(0, curI - 1); this.setState({ t: sortedNotes[i].start + 0.01, playing: false }); },
      onNext: (e) => { if (e) e.stopPropagation(); const i = Math.min(sortedNotes.length - 1, curI + 1); this.setState({ t: sortedNotes[i].start + 0.01, playing: false }); },
      onSeek: (e) => { const n = sortedNotes[Number(e.target.value)]; if (n) this.setState({ t: n.start + 0.01, playing: false }); },
      onBpm: (e) => this.setState({ bpm: Number(e.target.value) }),
      onMetro: () => this.setState({ metroOn: !st.metroOn }),
      onReverb: () => this.setState({ reverbOn: !st.reverbOn }),
      onMic: () => this.setState({ micOn: !st.micOn }),
      onLyrics: () => this.setState({ lyricsOn: !st.lyricsOn }),
      onZh: () => this.setState({ script: 'chinese' }),
      onPy: () => this.setState({ script: 'pinyin' }),
      onPosBand: () => this.setState({ lyricsPos: 'band' }),
      onPosNotes: () => this.setState({ lyricsPos: 'notes' }),
      onNotJp: () => this.setState({ notation: 'jianpu' }),
      onNotWe: () => this.setState({ notation: 'western' }),
      onViewPic: () => this.setState({ scoreView: 'picture' }),
      onViewJp: () => this.setState({ scoreView: 'jianpu' }),
      onTabImg: () => this.setState({ importTab: 'image' }),
      onTabMan: () => this.setState({ importTab: 'manual' }),
      onSrcJp: () => this.setState({ importSrc: 'jianpu' }),
      onSrcWe: () => this.setState({ importSrc: 'western' }),
      onCkLyrics: () => this.setState({ ckLyrics: !st.ckLyrics }),
      onCkPinyin: () => this.setState({ ckPinyin: !st.ckPinyin }),
      onChrome: () => this.setState({ chromeOn: !st.chromeOn }),
      onSwallow: (e) => { if (e) e.stopPropagation(); },
      metroPhBg: st.metroOn ? '#dcfce7' : 'rgba(255,255,255,0.12)', metroPhC: st.metroOn ? '#166534' : '#d4d4d4',
      revPhBg: st.reverbOn ? '#dcfce7' : 'rgba(255,255,255,0.12)', revPhC: st.reverbOn ? '#166534' : '#d4d4d4',
      micPhBg: st.micOn ? '#fee2e2' : 'rgba(255,255,255,0.12)', micPhC: st.micOn ? '#b91c1c' : '#d4d4d4',
      onUndo: () => this.undo(),
      onCopySel: () => this.copySel(),
      onPasteSel: () => this.pasteSel(),
      onClearSel: () => this.setState({ selIds: [] }),
      onDeleteSel: () => { if (!sel.length) return; this.pushHistory(); this.setState({ notes: st.notes.filter((n) => !st.selIds.includes(n.id)), selIds: [] }); },
      onRowUp: () => { if (!sel.length) return; this.pushHistory(); this.mutateSel((n) => ({ ...n, row: Math.max(0, n.row - 1) })); },
      onRowDown: () => { if (!sel.length) return; this.pushHistory(); this.mutateSel((n) => ({ ...n, row: Math.min(7, n.row + 1) })); },
      onSylChange: (e) => { if (!one) return; const v = e.target.value; this.pushHistory(); this.mutateSel((n) => (py ? { ...n, pi: v } : { ...n, zi: v })); },
      onRollDown: (e) => this.onRollDown(e),
      onRollMove: (e) => this.onRollMove(e),
      onRollUp: () => this.onRollUp(),
      onReverbLevel: (e) => this.setState({ reverbLevel: Number(e.target.value) }),
      onZoomIn: () => this.setState({ picZoom: Math.min(3, st.picZoom + 0.25) }),
      onZoomOut: () => this.setState({ picZoom: Math.max(0.5, st.picZoom - 0.25) }),
      onZoomReset: () => this.setState({ picZoom: 1 }),
      onPhoneNav: (e) => { if (e) e.stopPropagation(); this.setState({ phoneNav: !st.phoneNav }); },
      onRailStop: (e) => { if (e) e.stopPropagation(); this.setState({ railOpen: !st.railOpen }); },
      onImportStop: (e) => { if (e) e.stopPropagation(); this.setState({ importOpen: true, railOpen: false }); },
    };
  }
}
</script>
</body>
</html>

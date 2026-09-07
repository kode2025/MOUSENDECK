'use strict';
// Built-in shortcuts, grouped by category.
//
// A board holds *copies* of these, so deleting a button from a board never
// removes it from the catalog — it can always be re-added from Add shortcut.
// `needs` names the capability the target host must advertise; anything the
// connected device does not support is filtered out before it is ever shown.

const K = (key, ...mods) => ({ type: 'key', key, mods });
const M = (k) => ({ type: 'media', k });
const O = (target) => ({ type: 'open', target });

window.CATALOG = [
  // ── Editing ───────────────────────────────────────────────────────────
  { id:'edit.copy',      cat:'Editing', label:'Copy',        icon:'⧉',  color:'#4C8DFF', needs:'key', action:K('c','cmd') },
  { id:'edit.paste',     cat:'Editing', label:'Paste',       icon:'⇩',  color:'#4C8DFF', needs:'key', action:K('v','cmd') },
  { id:'edit.cut',       cat:'Editing', label:'Cut',         icon:'✂',  color:'#4C8DFF', needs:'key', action:K('x','cmd') },
  { id:'edit.undo',      cat:'Editing', label:'Undo',        icon:'⤺',  color:'#6366F1', needs:'key', action:K('z','cmd') },
  { id:'edit.redo',      cat:'Editing', label:'Redo',        icon:'⤻',  color:'#6366F1', needs:'key', action:K('z','cmd','shift') },
  { id:'edit.all',       cat:'Editing', label:'Select All',  icon:'▣',  color:'#4C8DFF', needs:'key', action:K('a','cmd') },
  { id:'edit.find',      cat:'Editing', label:'Find',        icon:'🔎', color:'#4C8DFF', needs:'key', action:K('f','cmd') },
  { id:'edit.save',      cat:'Editing', label:'Save',        icon:'💾', color:'#22C55E', needs:'key', action:K('s','cmd') },
  { id:'edit.pastematch',cat:'Editing', label:'Paste Plain', icon:'📋', color:'#4C8DFF', needs:'key', action:K('v','cmd','alt','shift') },
  { id:'edit.dup',       cat:'Editing', label:'Duplicate',   icon:'⧉＋',color:'#4C8DFF', needs:'key', action:K('d','cmd') },
  { id:'edit.findNext',  cat:'Editing', label:'Find Again',  icon:'⏭', color:'#4C8DFF', needs:'key', action:K('g','cmd') },
  { id:'edit.findPrev',  cat:'Editing', label:'Find Previous',icon:'⏮',color:'#4C8DFF', needs:'key', action:K('g','cmd','shift') },
  { id:'edit.open',      cat:'Editing', label:'Open…',       icon:'📂', color:'#4C8DFF', needs:'key', action:K('o','cmd') },
  { id:'edit.print',     cat:'Editing', label:'Print',       icon:'🖨', color:'#4C8DFF', needs:'key', action:K('p','cmd') },
  { id:'edit.saveAs',    cat:'Editing', label:'Save As',     icon:'🗂', color:'#22C55E', needs:'key', action:K('s','cmd','shift') },
  { id:'edit.settings',  cat:'Editing', label:'App Settings',icon:'⚙',  color:'#7C8494', needs:'key', action:K(',','cmd') },
  { id:'edit.help',      cat:'Editing', label:'Help Menu',   icon:'❓', color:'#7C8494', needs:'key', action:K('/','cmd','shift') },

  // ── Formatting ────────────────────────────────────────────────────────
  // `:` `?` `{` `}` `|` `+` are shifted characters, so they are sent as the
  // unshifted key plus Shift — there is no separate keycode for them.
  { id:'fmt.bold',      cat:'Formatting', label:'Bold',      icon:'𝐁', color:'#EC4899', needs:'key', action:K('b','cmd') },
  { id:'fmt.italic',    cat:'Formatting', label:'Italic',    icon:'𝐼', color:'#EC4899', needs:'key', action:K('i','cmd') },
  { id:'fmt.underline', cat:'Formatting', label:'Underline', icon:'U̲', color:'#EC4899', needs:'key', action:K('u','cmd') },
  { id:'fmt.link',      cat:'Formatting', label:'Add Link',  icon:'🔗', color:'#EC4899', needs:'key', action:K('k','cmd') },
  { id:'fmt.bigger',    cat:'Formatting', label:'Bigger',    icon:'🔠', color:'#EC4899', needs:'key', action:K('=','cmd','shift') },
  { id:'fmt.smaller',   cat:'Formatting', label:'Smaller',   icon:'🔡', color:'#EC4899', needs:'key', action:K('-','cmd','shift') },
  { id:'fmt.alignLeft', cat:'Formatting', label:'Align Left',  icon:'⬅', color:'#EC4899', needs:'key', action:K('[','cmd','shift') },
  { id:'fmt.alignCentre',cat:'Formatting',label:'Align Centre',icon:'↔', color:'#EC4899', needs:'key', action:K('\\','cmd','shift') },
  { id:'fmt.alignRight',cat:'Formatting', label:'Align Right', icon:'➡', color:'#EC4899', needs:'key', action:K(']','cmd','shift') },
  { id:'fmt.copyStyle', cat:'Formatting', label:'Copy Style',  icon:'🎨', color:'#EC4899', needs:'key', action:K('c','cmd','alt') },
  { id:'fmt.pasteStyle',cat:'Formatting', label:'Paste Style', icon:'🖌', color:'#EC4899', needs:'key', action:K('v','cmd','alt') },
  { id:'fmt.spelling',  cat:'Formatting', label:'Spelling',    icon:'📝', color:'#EC4899', needs:'key', action:K(';','cmd','shift') },
  { id:'fmt.checkSpell',cat:'Formatting', label:'Check Spelling',icon:'✓',color:'#EC4899', needs:'key', action:K(';','cmd') },
  { id:'fmt.define',    cat:'Formatting', label:'Define Word', icon:'📖', color:'#EC4899', needs:'key', action:K('d','cmd','ctrl') },
  { id:'fmt.fonts',     cat:'Formatting', label:'Fonts',       icon:'🔤', color:'#EC4899', needs:'key', action:K('t','cmd') },

  // ── Text navigation ───────────────────────────────────────────────────
  { id:'text.lineStart', cat:'Text', label:'Line Start',  icon:'⇤', color:'#8B5CF6', needs:'key', action:K('left','cmd') },
  { id:'text.lineEnd',   cat:'Text', label:'Line End',    icon:'⇥', color:'#8B5CF6', needs:'key', action:K('right','cmd') },
  { id:'text.docStart',  cat:'Text', label:'Doc Start',   icon:'⤒', color:'#8B5CF6', needs:'key', action:K('up','cmd') },
  { id:'text.docEnd',    cat:'Text', label:'Doc End',     icon:'⤓', color:'#8B5CF6', needs:'key', action:K('down','cmd') },
  { id:'text.wordLeft',  cat:'Text', label:'Word Left',   icon:'◀◀',color:'#8B5CF6', needs:'key', action:K('left','alt') },
  { id:'text.wordRight', cat:'Text', label:'Word Right',  icon:'▶▶',color:'#8B5CF6', needs:'key', action:K('right','alt') },
  { id:'text.delWord',   cat:'Text', label:'Delete Word', icon:'⌫', color:'#8B5CF6', needs:'key', action:K('delete','alt') },
  { id:'text.delLine',   cat:'Text', label:'Del to Line Start', icon:'⌦', color:'#8B5CF6', needs:'key', action:K('delete','cmd') },
  // Real Home/End/PageUp/PageDown keycodes rather than the Fn-arrow spelling.
  // Same result, and it does not depend on the Fn modifier surviving a
  // synthetic event, which is the least reliable part of the key path.
  { id:'text.fwdDel',    cat:'Text', label:'Forward Delete', icon:'⌦', color:'#8B5CF6', needs:'key', action:K('forwarddelete') },
  { id:'text.pageUp',    cat:'Text', label:'Page Up',     icon:'⇞', color:'#8B5CF6', needs:'key', action:K('pageup') },
  { id:'text.pageDown',  cat:'Text', label:'Page Down',   icon:'⇟', color:'#8B5CF6', needs:'key', action:K('pagedown') },
  { id:'text.home',      cat:'Text', label:'Top of Page', icon:'⤒', color:'#8B5CF6', needs:'key', action:K('home') },
  { id:'text.end',       cat:'Text', label:'End of Page', icon:'⤓', color:'#8B5CF6', needs:'key', action:K('end') },
  { id:'text.selLineStart',cat:'Text', label:'Select to Line Start', icon:'⇤', color:'#8B5CF6', needs:'key', action:K('left','cmd','shift') },
  { id:'text.selLineEnd', cat:'Text', label:'Select to Line End',  icon:'⇥', color:'#8B5CF6', needs:'key', action:K('right','cmd','shift') },
  { id:'text.selDocStart',cat:'Text', label:'Select to Top',  icon:'⇧⤒', color:'#8B5CF6', needs:'key', action:K('up','cmd','shift') },
  { id:'text.selDocEnd',  cat:'Text', label:'Select to End',  icon:'⇧⤓', color:'#8B5CF6', needs:'key', action:K('down','cmd','shift') },
  { id:'text.selWordLeft',cat:'Text', label:'Select Word ←', icon:'◀', color:'#8B5CF6', needs:'key', action:K('left','alt','shift') },
  { id:'text.selWordRight',cat:'Text',label:'Select Word →', icon:'▶', color:'#8B5CF6', needs:'key', action:K('right','alt','shift') },
  { id:'text.selParaUp',  cat:'Text', label:'Select Para ↑', icon:'¶', color:'#8B5CF6', needs:'key', action:K('up','alt','shift') },
  { id:'text.selParaDown',cat:'Text', label:'Select Para ↓', icon:'¶', color:'#8B5CF6', needs:'key', action:K('down','alt','shift') },

  // ── Windows & Spaces ──────────────────────────────────────────────────
  { id:'window.mission', cat:'Windows', label:'Mission Ctrl', icon:'▦', color:'#14B8A6', needs:'key', action:K('up','ctrl') },
  { id:'window.appwin',  cat:'Windows', label:'App Windows',  icon:'▤', color:'#14B8A6', needs:'key', action:K('down','ctrl') },
  { id:'window.spaceL',  cat:'Windows', label:'Space ←',      icon:'◀', color:'#14B8A6', needs:'key', action:K('left','ctrl') },
  { id:'window.spaceR',  cat:'Windows', label:'Space →',      icon:'▶', color:'#14B8A6', needs:'key', action:K('right','ctrl') },
  { id:'window.switch',  cat:'Windows', label:'App Switch',   icon:'⇄', color:'#14B8A6', needs:'key', action:K('tab','cmd') },
  { id:'window.close',   cat:'Windows', label:'Close Window', icon:'✕', color:'#F5A524', needs:'key', action:K('w','cmd') },
  { id:'window.min',     cat:'Windows', label:'Minimise',     icon:'▁', color:'#F5A524', needs:'key', action:K('m','cmd') },
  { id:'window.hide',    cat:'Windows', label:'Hide App',     icon:'👁', color:'#F5A524', needs:'key', action:K('h','cmd') },
  { id:'window.full',    cat:'Windows', label:'Full Screen',  icon:'⛶', color:'#14B8A6', needs:'key', action:K('f','cmd','ctrl') },
  { id:'window.newtab',  cat:'Windows', label:'New Tab',      icon:'＋', color:'#14B8A6', needs:'key', action:K('t','cmd') },
  { id:'window.desktop', cat:'Windows', label:'Show Desktop', icon:'🖥', color:'#14B8A6', needs:'key', action:K('f11') },
  // ⌘⌥Space is *Finder search*, not Launchpad — Launchpad has never had a
  // default chord. F4 is the key that opens it (Apps view on macOS 26).
  { id:'window.launchpad',cat:'Windows',label:'Launchpad',    icon:'⊞', color:'#14B8A6', needs:'key', action:K('f4') },
  { id:'window.findersearch',cat:'Windows',label:'Finder Search', icon:'🔦', color:'#14B8A6', needs:'key', action:K('space','cmd','alt') },
  { id:'window.new',     cat:'Windows', label:'New Window',   icon:'🗔', color:'#14B8A6', needs:'key', action:K('n','cmd') },
  { id:'window.cycle',   cat:'Windows', label:'Cycle Windows',icon:'⟳', color:'#14B8A6', needs:'key', action:K('`','cmd') },
  { id:'window.closeAll',cat:'Windows', label:'Close All',    icon:'✕✕',color:'#F5A524', needs:'key', action:K('w','cmd','alt') },
  { id:'window.minAll',  cat:'Windows', label:'Minimise All', icon:'▁▁',color:'#F5A524', needs:'key', action:K('m','cmd','alt') },
  { id:'window.hideOthers',cat:'Windows',label:'Hide Others', icon:'🙈', color:'#F5A524', needs:'key', action:K('h','cmd','alt') },
  { id:'window.dock',    cat:'Windows', label:'Show/Hide Dock',icon:'⬓', color:'#14B8A6', needs:'key', action:K('d','cmd','alt') },
  { id:'window.quicklook',cat:'Windows',label:'Quick Look',   icon:'👁', color:'#14B8A6', needs:'key', action:K('space') },

  // ── Screenshots ───────────────────────────────────────────────────────
  { id:'shot.area',   cat:'Screenshots', label:'Snip Area',   icon:'📸', color:'#F5A524', needs:'key', action:K('4','cmd','shift') },
  { id:'shot.full',   cat:'Screenshots', label:'Full Screen', icon:'🖼', color:'#F5A524', needs:'key', action:K('3','cmd','shift') },
  // ⌘⇧4 starts an area selection; pressing space switches it to window mode.
  { id:'shot.window', cat:'Screenshots', label:'Window', icon:'🪟', color:'#F5A524', needs:'multi',
    action:{ type:'multi', steps:[
      { type:'key', key:'4', mods:['cmd','shift'], after:250 },
      { type:'key', key:'space', mods:[] },
    ] } },
  { id:'shot.tools',  cat:'Screenshots', label:'Screenshot UI',icon:'🎛',color:'#F5A524', needs:'key', action:K('5','cmd','shift') },
  { id:'shot.clip',   cat:'Screenshots', label:'Shot to Clipboard', icon:'📋', color:'#F5A524', needs:'key', action:K('4','cmd','ctrl','shift') },
  { id:'shot.fullclip', cat:'Screenshots', label:'Full to Clipboard', icon:'🗒', color:'#F5A524', needs:'key', action:K('3','cmd','ctrl','shift') },

  // screencapture(1) records without going through the capture UI, so a single
  // tap starts a full-screen recording. -v is video; the file lands on the
  // Desktop with a timestamped name.
  { id:'rec.screen', cat:'Screenshots', label:'Record Screen', icon:'⏺', color:'#FF5C5C', needs:'shell',
    action:{ type:'shell', cmd:'screencapture -v "$HOME/Desktop/Recording-$(date +%Y-%m-%d-%H%M%S).mov"',
      as:'full screen' } },

  // Was ⌘⇧5, which only opens the capture bar in whatever mode it was last
  // left in — press it after taking a screenshot and you get the *photo* tool.
  // `-J video` forces the bar into video mode with the region selector up, so
  // one tap always lands you in "drag the area you want to record".
  { id:'rec.area', cat:'Screenshots', label:'Record Area', icon:'⏹', color:'#FF5C5C', needs:'shell',
    action:{ type:'shell',
      cmd:'screencapture -J video "$HOME/Desktop/Recording-$(date +%Y-%m-%d-%H%M%S).mov"',
      as:'pick an area' } },

  // screencapture stops cleanly on SIGINT and writes the file out. "Nothing to
  // stop" now comes back through the app rather than as a Mac notification —
  // you are looking at the iPad, not the Mac, when you press it.
  { id:'rec.stop', cat:'Screenshots', label:'Stop Recording', icon:'⏏', color:'#FF5C5C', needs:'shell',
    action:{ type:'shell',
      cmd:'pkill -INT screencapture || { echo "No recording is running." >&2; exit 1; }',
      as:'ends recording' } },

  // ── Media ─────────────────────────────────────────────────────────────
  { id:'media.playpause', cat:'Media', label:'Play',    icon:'⏯', color:'#8B5CF6', needs:'media', action:M('playpause') },
  { id:'media.next',      cat:'Media', label:'Next',    icon:'⏭', color:'#8B5CF6', needs:'media', action:M('next') },
  { id:'media.prev',      cat:'Media', label:'Prev',    icon:'⏮', color:'#8B5CF6', needs:'media', action:M('prev') },
  { id:'media.volup',     cat:'Media', label:'Vol +',   icon:'🔊', color:'#0EA5E9', needs:'media', action:M('soundup') },
  { id:'media.voldown',   cat:'Media', label:'Vol −',   icon:'🔉', color:'#0EA5E9', needs:'media', action:M('sounddown') },
  { id:'media.mute',      cat:'Media', label:'Mute',    icon:'🔇', color:'#0EA5E9', needs:'media', action:M('mute') },
  { id:'media.brightup',  cat:'Media', label:'Bright +',icon:'🔆', color:'#F5A524', needs:'media', action:M('brightnessup') },
  { id:'media.brightdown',cat:'Media', label:'Bright −',icon:'🔅', color:'#F5A524', needs:'media', action:M('brightnessdown') },

  // ── System ────────────────────────────────────────────────────────────
  { id:'system.spotlight', cat:'System', label:'Spotlight',   icon:'🔍', color:'#14B8A6', needs:'key', action:K('space','cmd') },
  { id:'system.lock',      cat:'System', label:'Lock Screen', icon:'🔒', color:'#FF5C5C', needs:'key', action:K('q','cmd','ctrl') },
  { id:'system.forcequit', cat:'System', label:'Force Quit',  icon:'⚠',  color:'#FF5C5C', needs:'key', action:K('escape','cmd','alt'), risky:true },
  { id:'system.quit',      cat:'System', label:'Quit App',    icon:'⏻',  color:'#FF5C5C', needs:'key', action:K('q','cmd'), risky:true },
  { id:'system.emoji',     cat:'System', label:'Emoji',       icon:'😀', color:'#F5A524', needs:'key', action:K('space','cmd','ctrl') },
  // Apple removed scriptable Focus control in macOS 12, and the Control Center
  // UI hierarchy moves between releases, so poking it with System Events breaks
  // on every update. Running a Shortcut is the only supported route — it needs
  // a one-time "Toggle DND" shortcut built from the Set Focus action.
  // The failure path used to be an `osascript display dialog`. A dialog put up
  // by osascript from a background process registers as its own app — which is
  // why pressing this looked like "the menu bar appeared" rather than either
  // Do Not Disturb turning on or an explanation. It now fails through the
  // normal channel instead, so the message lands on the device you pressed it
  // from, where you are actually looking.
  { id:'system.dnd',       cat:'System', label:'Do Not Disturb', icon:'🌙', color:'#6366F1', needs:'shell',
    setup:'Needs a one-time shortcut named "Toggle DND" (Set Focus action) in the Shortcuts app.',
    action:{ type:'shell', cmd:
      'shortcuts run "Toggle DND" 2>/dev/null || { '
      + 'echo "Do Not Disturb needs a one-time setup on the Mac. Open the Shortcuts app, '
      + 'create a shortcut named exactly \\"Toggle DND\\", give it the Set Focus action set '
      + 'to Do Not Disturb / Toggle, and save. This button will work from then on. Apple '
      + 'removed every other way to switch Focus from a script in macOS 12." >&2; exit 1; }',
      as:'via Shortcuts' } },
  { id:'system.dark',      cat:'System', label:'Dark Mode',   icon:'🌗', color:'#6366F1', needs:'applescript',
    action:{ type:'applescript', script:'tell app "System Events" to tell appearance preferences to set dark mode to not dark mode',
      as:'light ⇄ dark' } },
  { id:'system.sleepdisp', cat:'System', label:'Sleep Display', icon:'💤', color:'#6366F1', needs:'shell',
    action:{ type:'shell', cmd:'pmset displaysleepnow', as:'display off' } },
  { id:'system.logout',    cat:'System', label:'Log Out',      icon:'🚪', color:'#FF5C5C', needs:'key', action:K('q','cmd','shift'), risky:true },
  { id:'system.sleep',     cat:'System', label:'Sleep',        icon:'🌛', color:'#6366F1', needs:'shell',
    action:{ type:'shell', cmd:'pmset sleepnow', as:'whole Mac' } },
  { id:'system.screensaver',cat:'System',label:'Screen Saver', icon:'🖼', color:'#6366F1', needs:'shell',
    action:{ type:'shell', cmd:'open -a ScreenSaverEngine', as:'start now' } },
  // Apple documents these as Fn chords. macOS reads the real Fn key from the
  // hardware, and a synthetic .maskSecondaryFn does not always reach the
  // WindowServer hotkey layer — so each has a shell equivalent where one
  // exists, and those are the entries offered instead.
  { id:'system.invert',    cat:'System', label:'Invert Colours', icon:'◐', color:'#6366F1', needs:'key', action:K('8','cmd','ctrl','alt') },
  { id:'system.clipboard', cat:'System', label:'Clipboard Now',  icon:'📋', color:'#4C8DFF', needs:'shell',
    action:{ type:'shell', cmd:'pbpaste | head -c 400 | pbcopy', as:'trim clipboard' } },

  // ── Finder ────────────────────────────────────────────────────────────
  { id:'finder.new',      cat:'Finder', label:'New Folder',  icon:'📁', color:'#22C55E', needs:'key', action:K('n','cmd','shift') },
  { id:'finder.info',     cat:'Finder', label:'Get Info',    icon:'ℹ',  color:'#22C55E', needs:'key', action:K('i','cmd') },
  { id:'finder.rename',   cat:'Finder', label:'Rename',      icon:'✏',  color:'#22C55E', needs:'key', action:K('return') },
  { id:'finder.trash',    cat:'Finder', label:'Move to Trash',icon:'🗑', color:'#FF5C5C', needs:'key', action:K('delete','cmd'), risky:true },
  { id:'finder.hidden',   cat:'Finder', label:'Show Hidden', icon:'👻', color:'#22C55E', needs:'key', action:K('.','cmd','shift') },
  { id:'finder.goto',     cat:'Finder', label:'Go to Folder',icon:'➜',  color:'#22C55E', needs:'key', action:K('g','cmd','shift') },
  { id:'finder.newWindow',cat:'Finder', label:'New Window',  icon:'🗔', color:'#22C55E', needs:'key', action:K('n','cmd') },
  { id:'finder.dup',      cat:'Finder', label:'Duplicate',   icon:'⧉',  color:'#22C55E', needs:'key', action:K('d','cmd') },
  { id:'finder.eject',    cat:'Finder', label:'Eject',       icon:'⏏',  color:'#F5A524', needs:'key', action:K('e','cmd') },
  { id:'finder.original', cat:'Finder', label:'Show Original',icon:'↩', color:'#22C55E', needs:'key', action:K('r','cmd') },
  { id:'finder.alias',    cat:'Finder', label:'Make Alias',  icon:'🔗', color:'#22C55E', needs:'key', action:K('a','cmd','ctrl') },
  { id:'finder.moveHere', cat:'Finder', label:'Move Here',   icon:'📥', color:'#22C55E', needs:'key', action:K('v','cmd','alt') },
  { id:'finder.quicklook',cat:'Finder', label:'Quick Look',  icon:'👁', color:'#22C55E', needs:'key', action:K('y','cmd') },
  { id:'finder.viewOpts', cat:'Finder', label:'View Options',icon:'🎚', color:'#22C55E', needs:'key', action:K('j','cmd') },
  { id:'finder.connect',  cat:'Finder', label:'Connect to Server',icon:'🖧',color:'#22C55E', needs:'key', action:K('k','cmd') },
  { id:'finder.smart',    cat:'Finder', label:'New Smart Folder',icon:'🧠',color:'#22C55E', needs:'key', action:K('n','cmd','alt') },
  { id:'finder.folderSel',cat:'Finder', label:'Folder w/ Selection',icon:'📦',color:'#22C55E', needs:'key', action:K('n','cmd','ctrl') },
  { id:'finder.emptyTrash',cat:'Finder',label:'Empty Trash', icon:'🗑', color:'#FF5C5C', needs:'key', action:K('delete','cmd','shift'), risky:true },
  { id:'finder.back',     cat:'Finder', label:'Back',        icon:'←',  color:'#22C55E', needs:'key', action:K('[','cmd') },
  { id:'finder.fwd',      cat:'Finder', label:'Forward',     icon:'→',  color:'#22C55E', needs:'key', action:K(']','cmd') },
  { id:'finder.enclosing',cat:'Finder', label:'Enclosing Folder',icon:'⤴',color:'#22C55E', needs:'key', action:K('up','cmd') },
  { id:'finder.viewIcon', cat:'Finder', label:'Icon View',   icon:'▦', color:'#22C55E', needs:'key', action:K('1','cmd') },
  { id:'finder.viewList', cat:'Finder', label:'List View',   icon:'☰', color:'#22C55E', needs:'key', action:K('2','cmd') },
  { id:'finder.viewCol',  cat:'Finder', label:'Column View', icon:'▥', color:'#22C55E', needs:'key', action:K('3','cmd') },
  { id:'finder.viewGal',  cat:'Finder', label:'Gallery View',icon:'🖼', color:'#22C55E', needs:'key', action:K('4','cmd') },
  { id:'finder.sidebar',  cat:'Finder', label:'Sidebar',     icon:'◧', color:'#22C55E', needs:'key', action:K('s','cmd','alt') },
  { id:'finder.preview',  cat:'Finder', label:'Preview Pane',icon:'◨', color:'#22C55E', needs:'key', action:K('p','cmd','shift') },
  { id:'finder.pathbar',  cat:'Finder', label:'Path Bar',    icon:'⌥',  color:'#22C55E', needs:'key', action:K('p','cmd','alt') },
  { id:'finder.tabbar',   cat:'Finder', label:'Tab Bar',     icon:'⊞', color:'#22C55E', needs:'key', action:K('t','cmd','shift') },

  // ── Go to folder ──────────────────────────────────────────────────────
  { id:'go.home',      cat:'Go to', label:'Home',      icon:'🏠', color:'#0EA5E9', needs:'key', action:K('h','cmd','shift') },
  { id:'go.desktop',   cat:'Go to', label:'Desktop',   icon:'🖥', color:'#0EA5E9', needs:'key', action:K('d','cmd','shift') },
  { id:'go.documents', cat:'Go to', label:'Documents', icon:'📄', color:'#0EA5E9', needs:'key', action:K('o','cmd','shift') },
  { id:'go.downloads', cat:'Go to', label:'Downloads', icon:'⬇',  color:'#0EA5E9', needs:'key', action:K('l','cmd','alt') },
  { id:'go.apps',      cat:'Go to', label:'Applications',icon:'🗂',color:'#0EA5E9', needs:'key', action:K('a','cmd','shift') },
  { id:'go.utilities', cat:'Go to', label:'Utilities', icon:'🛠', color:'#0EA5E9', needs:'key', action:K('u','cmd','shift') },
  { id:'go.icloud',    cat:'Go to', label:'iCloud Drive',icon:'☁', color:'#0EA5E9', needs:'key', action:K('i','cmd','shift') },
  { id:'go.recents',   cat:'Go to', label:'Recents',   icon:'🕘', color:'#0EA5E9', needs:'key', action:K('f','cmd','shift') },
  { id:'go.airdrop',   cat:'Go to', label:'AirDrop',   icon:'📡', color:'#0EA5E9', needs:'key', action:K('r','cmd','shift') },
  { id:'go.network',   cat:'Go to', label:'Network',   icon:'🖧',  color:'#0EA5E9', needs:'key', action:K('k','cmd','shift') },
  { id:'go.computer',  cat:'Go to', label:'Computer',  icon:'💻', color:'#0EA5E9', needs:'key', action:K('c','cmd','shift') },

  // ── Apps ──────────────────────────────────────────────────────────────
  // Finder is always running, so plain `open -a Finder` activates an app that
  // may have no window and nothing visibly happens. The previous fix asked for
  // a window in AppleScript, which works — right up until macOS blocks it,
  // because driving another app needs *Automation* permission, a separate
  // grant from the Accessibility one this project already asks for. When it is
  // missing, osascript fails silently and the button does nothing.
  //
  // `open` needs no such permission. Opening a folder both activates Finder
  // and guarantees a window, which is the whole point of the button.
  { id:'app.finder',   cat:'Apps', label:'Finder',   icon:'📁', color:'#22C55E', needs:'open',
    action:O('~') },
  { id:'app.safari',   cat:'Apps', label:'Safari',   icon:'🧭', color:'#4C8DFF', needs:'open', action:O('Safari') },
  { id:'app.chrome',   cat:'Apps', label:'Chrome',   icon:'🌐', color:'#F5A524', needs:'open', action:O('Google Chrome') },
  { id:'app.terminal', cat:'Apps', label:'Terminal', icon:'⌘',  color:'#7C8494', needs:'open', action:O('Terminal') },
  { id:'app.vscode',   cat:'Apps', label:'VS Code',  icon:'📝', color:'#4C8DFF', needs:'open', action:O('Visual Studio Code') },
  { id:'app.spotify',  cat:'Apps', label:'Spotify',  icon:'🎵', color:'#22C55E', needs:'open', action:O('Spotify') },
  { id:'app.music',    cat:'Apps', label:'Music',    icon:'🎶', color:'#FF5C5C', needs:'open', action:O('Music') },
  { id:'app.mail',     cat:'Apps', label:'Mail',     icon:'✉',  color:'#4C8DFF', needs:'open', action:O('Mail') },
  { id:'app.notes',    cat:'Apps', label:'Notes',    icon:'🗒',  color:'#F5A524', needs:'open', action:O('Notes') },
  { id:'app.slack',    cat:'Apps', label:'Slack',    icon:'💬', color:'#8B5CF6', needs:'open', action:O('Slack') },
  { id:'app.settings', cat:'Apps', label:'Settings', icon:'⚙',  color:'#7C8494', needs:'open', action:O('System Settings') },

  // ── Browser ───────────────────────────────────────────────────────────
  { id:'web.reload',   cat:'Browser', label:'Reload',     icon:'↻', color:'#0EA5E9', needs:'key', action:K('r','cmd') },
  { id:'web.hardload', cat:'Browser', label:'Hard Reload',icon:'⟳', color:'#0EA5E9', needs:'key', action:K('r','cmd','shift') },
  { id:'web.back',     cat:'Browser', label:'Back',       icon:'←', color:'#0EA5E9', needs:'key', action:K('[','cmd') },
  { id:'web.fwd',      cat:'Browser', label:'Forward',    icon:'→', color:'#0EA5E9', needs:'key', action:K(']','cmd') },
  { id:'web.reopen',   cat:'Browser', label:'Reopen Tab', icon:'⎌', color:'#0EA5E9', needs:'key', action:K('t','cmd','shift') },
  { id:'web.devtools', cat:'Browser', label:'DevTools',   icon:'🛠', color:'#0EA5E9', needs:'key', action:K('i','cmd','alt') },
  { id:'web.zoomin',   cat:'Browser', label:'Zoom In',    icon:'➕', color:'#0EA5E9', needs:'key', action:K('=','cmd') },
  { id:'web.zoomout',  cat:'Browser', label:'Zoom Out',   icon:'➖', color:'#0EA5E9', needs:'key', action:K('-','cmd') },
  { id:'web.zoomreset',cat:'Browser', label:'Reset Zoom', icon:'⭯', color:'#0EA5E9', needs:'key', action:K('0','cmd') },
  { id:'web.address',  cat:'Browser', label:'Address Bar',icon:'🔗', color:'#0EA5E9', needs:'key', action:K('l','cmd') },
  { id:'web.newwin',   cat:'Browser', label:'New Window', icon:'🗔', color:'#0EA5E9', needs:'key', action:K('n','cmd') },
  { id:'web.private',  cat:'Browser', label:'Private Window',icon:'🕶',color:'#0EA5E9', needs:'key', action:K('n','cmd','shift') },
  { id:'web.closetab', cat:'Browser', label:'Close Tab',  icon:'✕', color:'#0EA5E9', needs:'key', action:K('w','cmd') },
  { id:'web.nexttab',  cat:'Browser', label:'Next Tab',   icon:'▶', color:'#0EA5E9', needs:'key', action:K('tab','ctrl') },
  { id:'web.prevtab',  cat:'Browser', label:'Prev Tab',   icon:'◀', color:'#0EA5E9', needs:'key', action:K('tab','ctrl','shift') },
  { id:'web.tab1',     cat:'Browser', label:'Tab 1',      icon:'①', color:'#0EA5E9', needs:'key', action:K('1','cmd') },
  { id:'web.reader',   cat:'Browser', label:'Reader Mode',icon:'📖', color:'#0EA5E9', needs:'key', action:K('r','cmd','shift') },
  { id:'web.find',     cat:'Browser', label:'Find on Page',icon:'🔎',color:'#0EA5E9', needs:'key', action:K('f','cmd') },
  { id:'web.console',  cat:'Browser', label:'JS Console', icon:'🖥', color:'#0EA5E9', needs:'key', action:K('c','cmd','alt') },
  { id:'web.source',   cat:'Browser', label:'View Source',icon:'📜', color:'#0EA5E9', needs:'key', action:K('u','cmd','alt') },
  { id:'web.stop',     cat:'Browser', label:'Stop Loading',icon:'⛔',color:'#0EA5E9', needs:'key', action:K('escape') },

  // ── Code editor (VS Code / Cursor bindings on macOS) ──────────────────
  { id:'code.palette', cat:'Code', label:'Command Palette',icon:'⌘⇧P',color:'#6366F1', needs:'key', action:K('p','cmd','shift') },
  { id:'code.goto',    cat:'Code', label:'Go to File',   icon:'🗎', color:'#6366F1', needs:'key', action:K('p','cmd') },
  { id:'code.terminal',cat:'Code', label:'Terminal',     icon:'▤', color:'#6366F1', needs:'key', action:K('`','ctrl') },
  { id:'code.sidebar', cat:'Code', label:'Sidebar',      icon:'◧', color:'#6366F1', needs:'key', action:K('b','cmd') },
  { id:'code.explorer',cat:'Code', label:'Explorer',     icon:'🗂', color:'#6366F1', needs:'key', action:K('e','cmd','shift') },
  { id:'code.scm',     cat:'Code', label:'Source Control',icon:'⑂', color:'#6366F1', needs:'key', action:K('g','cmd','shift') },
  { id:'code.comment', cat:'Code', label:'Toggle Comment',icon:'//', color:'#6366F1', needs:'key', action:K('/','cmd') },
  { id:'code.delLine', cat:'Code', label:'Delete Line',  icon:'⌫', color:'#6366F1', needs:'key', action:K('k','cmd','shift') },
  { id:'code.lineUp',  cat:'Code', label:'Move Line ↑',  icon:'↑', color:'#6366F1', needs:'key', action:K('up','alt') },
  { id:'code.lineDown',cat:'Code', label:'Move Line ↓',  icon:'↓', color:'#6366F1', needs:'key', action:K('down','alt') },
  { id:'code.copyUp',  cat:'Code', label:'Copy Line ↑',  icon:'⧉↑',color:'#6366F1', needs:'key', action:K('up','alt','shift') },
  { id:'code.copyDown',cat:'Code', label:'Copy Line ↓',  icon:'⧉↓',color:'#6366F1', needs:'key', action:K('down','alt','shift') },
  { id:'code.multi',   cat:'Code', label:'Select Next Match',icon:'⧉',color:'#6366F1', needs:'key', action:K('d','cmd') },
  { id:'code.def',     cat:'Code', label:'Go to Definition',icon:'➜',color:'#6366F1', needs:'key', action:K('f12') },
  { id:'code.settings',cat:'Code', label:'Settings',     icon:'⚙',  color:'#6366F1', needs:'key', action:K(',','cmd') },
  { id:'code.format',  cat:'Code', label:'Format Document',icon:'✨',color:'#6366F1', needs:'key', action:K('f','cmd','shift','alt') },

  // ── Terminal ──────────────────────────────────────────────────────────
  // Control chords, not shell commands. A `shell` action runs detached on the
  // Mac and never touches the terminal you are looking at — whereas ⌃C, ⌃R and
  // ⌃L land in whatever shell is in front, which is the point of having them
  // on a deck: the awkward two-handed ones, one tap away.
  { id:'term.interrupt', cat:'Terminal', label:'Interrupt ⌃C', icon:'⛔', color:'#FF5C5C', needs:'key', action:K('c','ctrl') },
  { id:'term.eof',       cat:'Terminal', label:'EOF ⌃D',       icon:'⏏',  color:'#F5A524', needs:'key', action:K('d','ctrl') },
  { id:'term.suspend',   cat:'Terminal', label:'Suspend ⌃Z',   icon:'⏸', color:'#F5A524', needs:'key', action:K('z','ctrl') },
  { id:'term.clear',     cat:'Terminal', label:'Clear ⌃L',     icon:'🧹', color:'#7C8494', needs:'key', action:K('l','ctrl') },
  { id:'term.search',    cat:'Terminal', label:'History Search',icon:'🔍',color:'#7C8494', needs:'key', action:K('r','ctrl') },
  { id:'term.lineStart', cat:'Terminal', label:'Line Start ⌃A',icon:'⇤', color:'#7C8494', needs:'key', action:K('a','ctrl') },
  { id:'term.lineEnd',   cat:'Terminal', label:'Line End ⌃E',  icon:'⇥', color:'#7C8494', needs:'key', action:K('e','ctrl') },
  { id:'term.killLine',  cat:'Terminal', label:'Kill to End ⌃K',icon:'✂', color:'#7C8494', needs:'key', action:K('k','ctrl') },
  { id:'term.killStart', cat:'Terminal', label:'Kill to Start ⌃U',icon:'✂',color:'#7C8494', needs:'key', action:K('u','ctrl') },
  { id:'term.killWord',  cat:'Terminal', label:'Kill Word ⌃W', icon:'⌫', color:'#7C8494', needs:'key', action:K('w','ctrl') },
  { id:'term.yank',      cat:'Terminal', label:'Yank ⌃Y',      icon:'📋', color:'#7C8494', needs:'key', action:K('y','ctrl') },
  { id:'term.newTab',    cat:'Terminal', label:'New Tab',      icon:'＋', color:'#22C55E', needs:'key', action:K('t','cmd') },
  { id:'term.newWindow', cat:'Terminal', label:'New Window',   icon:'🗔', color:'#22C55E', needs:'key', action:K('n','cmd') },
  { id:'term.closeTab',  cat:'Terminal', label:'Close Tab',    icon:'✕', color:'#F5A524', needs:'key', action:K('w','cmd') },
  { id:'term.clearBuf',  cat:'Terminal', label:'Clear Scrollback',icon:'🗑',color:'#7C8494', needs:'key', action:K('k','cmd') },
  { id:'term.nextTab',   cat:'Terminal', label:'Next Tab',     icon:'▶', color:'#7C8494', needs:'key', action:K(']','cmd','shift') },
  { id:'term.prevTab',   cat:'Terminal', label:'Prev Tab',     icon:'◀', color:'#7C8494', needs:'key', action:K('[','cmd','shift') },
  { id:'term.split',     cat:'Terminal', label:'Split Pane',   icon:'▤', color:'#7C8494', needs:'key', action:K('d','cmd') },
];

// Windows Precision Touchpad gestures, shown in the picker for reference and
// used when the connected device runs Windows. Same honesty rule as macOS:
// `mode` says whether it is real input or a keyboard equivalent.
window.WINDOWS_GESTURES = [
  { id:'tap1',       label:'One-finger tap',           mode:'native', does:'Left click' },
  { id:'tap2',       label:'Two-finger tap',           mode:'native', does:'Right click' },
  { id:'doubletap',  label:'Double tap',               mode:'native', does:'Double click' },
  { id:'drag1',      label:'One-finger drag',          mode:'native', does:'Move pointer' },
  { id:'scroll2',    label:'Two-finger scroll',        mode:'native', does:'Scroll' },
  { id:'tap3',       label:'Three-finger tap',         mode:'mapped', key:'s',     mods:['win'],         does:'Search' },
  { id:'tap4',       label:'Four-finger tap',          mode:'mapped', key:'a',     mods:['win'],         does:'Action Centre' },
  { id:'swipe3up',   label:'Three-finger swipe up',    mode:'mapped', key:'tab',   mods:['win'],         does:'Task View' },
  { id:'swipe3down', label:'Three-finger swipe down',  mode:'mapped', key:'d',     mods:['win'],         does:'Show Desktop' },
  { id:'swipe3left', label:'Three-finger swipe left',  mode:'mapped', key:'tab',   mods:['alt'],         does:'Previous app' },
  { id:'swipe3right',label:'Three-finger swipe right', mode:'mapped', key:'tab',   mods:['alt'],         does:'Next app' },
  { id:'swipe4left', label:'Four-finger swipe left',   mode:'mapped', key:'left',  mods:['win','ctrl'],  does:'Previous desktop' },
  { id:'swipe4right',label:'Four-finger swipe right',  mode:'mapped', key:'right', mods:['win','ctrl'],  does:'Next desktop' },
  { id:'pinchopen',  label:'Pinch out',                mode:'mapped', key:'=',     mods:['ctrl'],        does:'Zoom in' },
  { id:'pinchclose', label:'Pinch in',                 mode:'mapped', key:'-',     mods:['ctrl'],        does:'Zoom out' },
  { id:'rotate',     label:'Two-finger rotate',        mode:'none',   why:'App-specific; no system equivalent.' },
];

// Windows shortcut catalog. Same shape as the macOS one, different vocabulary:
// ctrl where macOS uses cmd, plus the Windows key.
const W = (key, ...mods) => ({ type: 'key', key, mods });

window.CATALOG_WINDOWS = [
  // Editing
  { id:'w.edit.copy',  cat:'Editing', label:'Copy',  icon:'⧉', color:'#4C8DFF', needs:'key', action:W('c',['ctrl']) },
  { id:'w.edit.paste', cat:'Editing', label:'Paste', icon:'⇩', color:'#4C8DFF', needs:'key', action:W('v',['ctrl']) },
  { id:'w.edit.cut',   cat:'Editing', label:'Cut',   icon:'✂', color:'#4C8DFF', needs:'key', action:W('x',['ctrl']) },
  { id:'w.edit.undo',  cat:'Editing', label:'Undo',  icon:'⤺', color:'#6366F1', needs:'key', action:W('z',['ctrl']) },
  { id:'w.edit.redo',  cat:'Editing', label:'Redo',  icon:'⤻', color:'#6366F1', needs:'key', action:W('y',['ctrl']) },
  { id:'w.edit.all',   cat:'Editing', label:'Select All', icon:'▣', color:'#4C8DFF', needs:'key', action:W('a',['ctrl']) },
  { id:'w.edit.find',  cat:'Editing', label:'Find',  icon:'🔎', color:'#4C8DFF', needs:'key', action:W('f',['ctrl']) },
  { id:'w.edit.save',  cat:'Editing', label:'Save',  icon:'💾', color:'#22C55E', needs:'key', action:W('s',['ctrl']) },
  { id:'w.edit.paster', cat:'Editing', label:'Paste Plain', icon:'📋', color:'#4C8DFF', needs:'key', action:W('v',['ctrl','shift']) },

  // Text
  { id:'w.text.lineStart', cat:'Text', label:'Line Start', icon:'⇤', color:'#8B5CF6', needs:'key', action:W('home') },
  { id:'w.text.lineEnd',   cat:'Text', label:'Line End',   icon:'⇥', color:'#8B5CF6', needs:'key', action:W('end') },
  { id:'w.text.docStart',  cat:'Text', label:'Doc Start',  icon:'⤒', color:'#8B5CF6', needs:'key', action:W('home',['ctrl']) },
  { id:'w.text.docEnd',    cat:'Text', label:'Doc End',    icon:'⤓', color:'#8B5CF6', needs:'key', action:W('end',['ctrl']) },
  { id:'w.text.wordLeft',  cat:'Text', label:'Word Left',  icon:'◀◀', color:'#8B5CF6', needs:'key', action:W('left',['ctrl']) },
  { id:'w.text.wordRight', cat:'Text', label:'Word Right', icon:'▶▶', color:'#8B5CF6', needs:'key', action:W('right',['ctrl']) },
  { id:'w.text.delWord',   cat:'Text', label:'Delete Word', icon:'⌫', color:'#8B5CF6', needs:'key', action:W('delete',['ctrl']) },

  // Windows & desktops
  { id:'w.win.taskview',  cat:'Windows', label:'Task View',  icon:'▦', color:'#14B8A6', needs:'key', action:W('tab',['win']) },
  { id:'w.win.desktop',   cat:'Windows', label:'Show Desktop', icon:'🖥', color:'#14B8A6', needs:'key', action:W('d',['win']) },
  { id:'w.win.deskLeft',  cat:'Windows', label:'Desktop ←', icon:'◀', color:'#14B8A6', needs:'key', action:W('left',['win','ctrl']) },
  { id:'w.win.deskRight', cat:'Windows', label:'Desktop →', icon:'▶', color:'#14B8A6', needs:'key', action:W('right',['win','ctrl']) },
  { id:'w.win.switch',    cat:'Windows', label:'Alt-Tab',   icon:'⇄', color:'#14B8A6', needs:'key', action:W('tab',['alt']) },
  { id:'w.win.close',     cat:'Windows', label:'Close Window', icon:'✕', color:'#F5A524', needs:'key', action:W('f4',['alt']) },
  { id:'w.win.min',       cat:'Windows', label:'Minimise',  icon:'▁', color:'#F5A524', needs:'key', action:W('down',['win']) },
  { id:'w.win.max',       cat:'Windows', label:'Maximise',  icon:'▔', color:'#F5A524', needs:'key', action:W('up',['win']) },
  { id:'w.win.snapL',     cat:'Windows', label:'Snap Left', icon:'◧', color:'#14B8A6', needs:'key', action:W('left',['win']) },
  { id:'w.win.snapR',     cat:'Windows', label:'Snap Right', icon:'◨', color:'#14B8A6', needs:'key', action:W('right',['win']) },
  { id:'w.win.lock',      cat:'Windows', label:'Lock',      icon:'🔒', color:'#FF5C5C', needs:'key', action:W('l',['win']) },

  // Screenshots
  { id:'w.shot.snip', cat:'Screenshots', label:'Snip',    icon:'📸', color:'#F5A524', needs:'key', action:W('s',['win','shift']) },
  { id:'w.shot.full', cat:'Screenshots', label:'PrtScr',  icon:'🖼', color:'#F5A524', needs:'key', action:W('printscreen') },
  { id:'w.shot.rec',  cat:'Screenshots', label:'Game Bar', icon:'⏺', color:'#FF5C5C', needs:'key', action:W('g',['win']) },

  // System
  { id:'w.sys.search',    cat:'System', label:'Search',    icon:'🔍', color:'#14B8A6', needs:'key', action:W('s',['win']) },
  { id:'w.sys.run',       cat:'System', label:'Run',       icon:'▶', color:'#7C8494', needs:'key', action:W('r',['win']) },
  { id:'w.sys.explorer',  cat:'System', label:'Explorer',  icon:'📁', color:'#22C55E', needs:'key', action:W('e',['win']) },
  { id:'w.sys.settings',  cat:'System', label:'Settings',  icon:'⚙', color:'#7C8494', needs:'key', action:W('i',['win']) },
  { id:'w.sys.clipboard', cat:'System', label:'Clipboard', icon:'📋', color:'#4C8DFF', needs:'key', action:W('v',['win']) },
  { id:'w.sys.action',    cat:'System', label:'Notifications', icon:'🔔', color:'#6366F1', needs:'key', action:W('n',['win']) },
  { id:'w.sys.emoji',     cat:'System', label:'Emoji',     icon:'😀', color:'#F5A524', needs:'key', action:W('.',['win']) },
  { id:'w.sys.taskmgr',   cat:'System', label:'Task Manager', icon:'⚠', color:'#FF5C5C', needs:'key', action:W('escape',['ctrl','shift']), risky:true },

  // Browser
  { id:'w.web.reload',   cat:'Browser', label:'Reload',      icon:'↻', color:'#0EA5E9', needs:'key', action:W('r',['ctrl']) },
  { id:'w.web.hardload', cat:'Browser', label:'Hard Reload', icon:'⟳', color:'#0EA5E9', needs:'key', action:W('r',['ctrl','shift']) },
  { id:'w.web.back',     cat:'Browser', label:'Back',        icon:'←', color:'#0EA5E9', needs:'key', action:W('left',['alt']) },
  { id:'w.web.fwd',      cat:'Browser', label:'Forward',     icon:'→', color:'#0EA5E9', needs:'key', action:W('right',['alt']) },
  { id:'w.web.newtab',   cat:'Browser', label:'New Tab',     icon:'＋', color:'#0EA5E9', needs:'key', action:W('t',['ctrl']) },
  { id:'w.web.reopen',   cat:'Browser', label:'Reopen Tab',  icon:'⎌', color:'#0EA5E9', needs:'key', action:W('t',['ctrl','shift']) },
  { id:'w.web.devtools', cat:'Browser', label:'DevTools',    icon:'🛠', color:'#0EA5E9', needs:'key', action:W('f12') },
  { id:'w.web.zoomin',   cat:'Browser', label:'Zoom In',     icon:'➕', color:'#0EA5E9', needs:'key', action:W('=',['ctrl']) },
  { id:'w.web.zoomout',  cat:'Browser', label:'Zoom Out',    icon:'➖', color:'#0EA5E9', needs:'key', action:W('-',['ctrl']) },

  // Media (Windows exposes these as real media keys)
  { id:'w.media.playpause', cat:'Media', label:'Play',  icon:'⏯', color:'#8B5CF6', needs:'media', action:{type:'media',k:'playpause'} },
  { id:'w.media.next',      cat:'Media', label:'Next',  icon:'⏭', color:'#8B5CF6', needs:'media', action:{type:'media',k:'next'} },
  { id:'w.media.prev',      cat:'Media', label:'Prev',  icon:'⏮', color:'#8B5CF6', needs:'media', action:{type:'media',k:'prev'} },
  { id:'w.media.volup',     cat:'Media', label:'Vol +', icon:'🔊', color:'#0EA5E9', needs:'media', action:{type:'media',k:'soundup'} },
  { id:'w.media.voldown',   cat:'Media', label:'Vol −', icon:'🔉', color:'#0EA5E9', needs:'media', action:{type:'media',k:'sounddown'} },
  { id:'w.media.mute',      cat:'Media', label:'Mute',  icon:'🔇', color:'#0EA5E9', needs:'media', action:{type:'media',k:'mute'} },

  // Windows 11 / 10 system surfaces
  { id:'w.sys.quicksettings',cat:'System', label:'Quick Settings',icon:'⚡', color:'#6366F1', needs:'key', action:W('a',['win']) },
  { id:'w.sys.widgets',   cat:'System', label:'Widgets',    icon:'🧩', color:'#6366F1', needs:'key', action:W('w',['win']) },
  { id:'w.sys.snap',      cat:'Windows',label:'Snap Layouts',icon:'▦', color:'#14B8A6', needs:'key', action:W('z',['win']) },
  { id:'w.sys.quicklink', cat:'System', label:'Quick Link', icon:'☰', color:'#7C8494', needs:'key', action:W('x',['win']) },
  { id:'w.sys.dictate',   cat:'System', label:'Dictation',  icon:'🎙', color:'#6366F1', needs:'key', action:W('h',['win']) },
  { id:'w.sys.copilot',   cat:'System', label:'Copilot',    icon:'🤖', color:'#4C8DFF', needs:'key', action:W('c',['win']) },
  { id:'w.sys.cast',      cat:'System', label:'Cast',       icon:'📺', color:'#6366F1', needs:'key', action:W('k',['win']) },
  { id:'w.sys.project',   cat:'System', label:'Project',    icon:'🖥', color:'#6366F1', needs:'key', action:W('p',['win']) },
  { id:'w.sys.magnifier', cat:'System', label:'Magnifier',  icon:'🔍', color:'#6366F1', needs:'key', action:W('=',['win']) },
  { id:'w.sys.narrator',  cat:'System', label:'Narrator',   icon:'🗣', color:'#6366F1', needs:'key', action:W('return',['win']) },
  { id:'w.sys.access',    cat:'System', label:'Accessibility',icon:'♿',color:'#6366F1', needs:'key', action:W('u',['win']) },
  { id:'w.sys.emoji2',    cat:'System', label:'Emoji (;)',  icon:'😀', color:'#F5A524', needs:'key', action:W(';',['win']) },

  // Virtual desktops
  { id:'w.desk.new',    cat:'Windows', label:'New Desktop',  icon:'➕', color:'#14B8A6', needs:'key', action:W('d',['win','ctrl']) },
  { id:'w.desk.close',  cat:'Windows', label:'Close Desktop',icon:'✕', color:'#F5A524', needs:'key', action:W('f4',['win','ctrl']) },
  { id:'w.win.moveL',   cat:'Windows', label:'Move to Left Screen', icon:'⇤', color:'#14B8A6', needs:'key', action:W('left',['win','shift']) },
  { id:'w.win.moveR',   cat:'Windows', label:'Move to Right Screen',icon:'⇥', color:'#14B8A6', needs:'key', action:W('right',['win','shift']) },

  // File Explorer
  { id:'w.fe.address',  cat:'Finder', label:'Address Bar', icon:'🔗', color:'#22C55E', needs:'key', action:W('d',['alt']) },
  { id:'w.fe.search',   cat:'Finder', label:'Search Box',  icon:'🔎', color:'#22C55E', needs:'key', action:W('e',['ctrl']) },
  { id:'w.fe.newFolder',cat:'Finder', label:'New Folder',  icon:'📁', color:'#22C55E', needs:'key', action:W('n',['ctrl','shift']) },
  { id:'w.fe.back',     cat:'Finder', label:'Back',        icon:'←', color:'#22C55E', needs:'key', action:W('left',['alt']) },
  { id:'w.fe.fwd',      cat:'Finder', label:'Forward',     icon:'→', color:'#22C55E', needs:'key', action:W('right',['alt']) },
  { id:'w.fe.up',       cat:'Finder', label:'Up One Level',icon:'⤴', color:'#22C55E', needs:'key', action:W('up',['alt']) },
  { id:'w.fe.rename',   cat:'Finder', label:'Rename',      icon:'✏', color:'#22C55E', needs:'key', action:W('f2') },
  { id:'w.fe.refresh',  cat:'Finder', label:'Refresh',     icon:'↻', color:'#22C55E', needs:'key', action:W('f5') },
  { id:'w.fe.props',    cat:'Finder', label:'Properties',  icon:'ℹ', color:'#22C55E', needs:'key', action:W('return',['alt']) },
  { id:'w.fe.delete',   cat:'Finder', label:'Delete',      icon:'🗑', color:'#FF5C5C', needs:'key', action:W('delete'), risky:true },

  // Formatting — Ctrl where macOS uses Cmd
  { id:'w.fmt.bold',    cat:'Formatting', label:'Bold',      icon:'𝐁', color:'#EC4899', needs:'key', action:W('b',['ctrl']) },
  { id:'w.fmt.italic',  cat:'Formatting', label:'Italic',    icon:'𝐼', color:'#EC4899', needs:'key', action:W('i',['ctrl']) },
  { id:'w.fmt.underline',cat:'Formatting',label:'Underline', icon:'U̲', color:'#EC4899', needs:'key', action:W('u',['ctrl']) },
  { id:'w.fmt.link',    cat:'Formatting', label:'Add Link',  icon:'🔗', color:'#EC4899', needs:'key', action:W('k',['ctrl']) },
  { id:'w.fmt.left',    cat:'Formatting', label:'Align Left',  icon:'⬅', color:'#EC4899', needs:'key', action:W('l',['ctrl']) },
  { id:'w.fmt.centre',  cat:'Formatting', label:'Align Centre',icon:'↔', color:'#EC4899', needs:'key', action:W('e',['ctrl']) },
  { id:'w.fmt.right',   cat:'Formatting', label:'Align Right', icon:'➡', color:'#EC4899', needs:'key', action:W('r',['ctrl']) },
  { id:'w.fmt.justify', cat:'Formatting', label:'Justify',     icon:'▤', color:'#EC4899', needs:'key', action:W('j',['ctrl']) },

  // Text navigation
  { id:'w.text.selWordL',cat:'Text', label:'Select Word ←', icon:'◀', color:'#8B5CF6', needs:'key', action:W('left',['ctrl','shift']) },
  { id:'w.text.selWordR',cat:'Text', label:'Select Word →', icon:'▶', color:'#8B5CF6', needs:'key', action:W('right',['ctrl','shift']) },
  { id:'w.text.selLineS',cat:'Text', label:'Select to Line Start',icon:'⇤', color:'#8B5CF6', needs:'key', action:W('home',['shift']) },
  { id:'w.text.selLineE',cat:'Text', label:'Select to Line End',  icon:'⇥', color:'#8B5CF6', needs:'key', action:W('end',['shift']) },
  { id:'w.text.delWordF',cat:'Text', label:'Delete Next Word',    icon:'⌦', color:'#8B5CF6', needs:'key', action:W('delete',['ctrl']) },
  { id:'w.text.pageUp',  cat:'Text', label:'Page Up',   icon:'⇞', color:'#8B5CF6', needs:'key', action:W('pageup') },
  { id:'w.text.pageDown',cat:'Text', label:'Page Down', icon:'⇟', color:'#8B5CF6', needs:'key', action:W('pagedown') },

  // Browser
  { id:'w.web.address', cat:'Browser', label:'Address Bar', icon:'🔗', color:'#0EA5E9', needs:'key', action:W('l',['ctrl']) },
  { id:'w.web.private', cat:'Browser', label:'Incognito',   icon:'🕶', color:'#0EA5E9', needs:'key', action:W('n',['ctrl','shift']) },
  { id:'w.web.closetab',cat:'Browser', label:'Close Tab',   icon:'✕', color:'#0EA5E9', needs:'key', action:W('w',['ctrl']) },
  { id:'w.web.nexttab', cat:'Browser', label:'Next Tab',    icon:'▶', color:'#0EA5E9', needs:'key', action:W('tab',['ctrl']) },
  { id:'w.web.prevtab', cat:'Browser', label:'Prev Tab',    icon:'◀', color:'#0EA5E9', needs:'key', action:W('tab',['ctrl','shift']) },
  { id:'w.web.zoomreset',cat:'Browser',label:'Reset Zoom',  icon:'⭯', color:'#0EA5E9', needs:'key', action:W('0',['ctrl']) },
  { id:'w.web.fullscreen',cat:'Browser',label:'Full Screen',icon:'⛶', color:'#0EA5E9', needs:'key', action:W('f11') },
  { id:'w.web.source',  cat:'Browser', label:'View Source', icon:'📜', color:'#0EA5E9', needs:'key', action:W('u',['ctrl']) },

  // Code editor
  { id:'w.code.palette',cat:'Code', label:'Command Palette',icon:'⌃⇧P',color:'#6366F1', needs:'key', action:W('p',['ctrl','shift']) },
  { id:'w.code.goto',   cat:'Code', label:'Go to File',    icon:'🗎', color:'#6366F1', needs:'key', action:W('p',['ctrl']) },
  { id:'w.code.terminal',cat:'Code',label:'Terminal',      icon:'▤', color:'#6366F1', needs:'key', action:W('`',['ctrl']) },
  { id:'w.code.sidebar',cat:'Code', label:'Sidebar',       icon:'◧', color:'#6366F1', needs:'key', action:W('b',['ctrl']) },
  { id:'w.code.comment',cat:'Code', label:'Toggle Comment',icon:'//', color:'#6366F1', needs:'key', action:W('/',['ctrl']) },
  { id:'w.code.delLine',cat:'Code', label:'Delete Line',   icon:'⌫', color:'#6366F1', needs:'key', action:W('k',['ctrl','shift']) },
  { id:'w.code.lineUp', cat:'Code', label:'Move Line ↑',   icon:'↑', color:'#6366F1', needs:'key', action:W('up',['alt']) },
  { id:'w.code.lineDown',cat:'Code',label:'Move Line ↓',   icon:'↓', color:'#6366F1', needs:'key', action:W('down',['alt']) },
  { id:'w.code.multi',  cat:'Code', label:'Select Next Match',icon:'⧉',color:'#6366F1', needs:'key', action:W('d',['ctrl']) },
  { id:'w.code.def',    cat:'Code', label:'Go to Definition',icon:'➜',color:'#6366F1', needs:'key', action:W('f12') },

  // Terminal / PowerShell control chords
  { id:'w.term.interrupt',cat:'Terminal', label:'Interrupt ⌃C', icon:'⛔', color:'#FF5C5C', needs:'key', action:W('c',['ctrl']) },
  { id:'w.term.eof',      cat:'Terminal', label:'EOF ⌃D',       icon:'⏏',  color:'#F5A524', needs:'key', action:W('d',['ctrl']) },
  { id:'w.term.clear',    cat:'Terminal', label:'Clear ⌃L',     icon:'🧹', color:'#7C8494', needs:'key', action:W('l',['ctrl']) },
  { id:'w.term.search',   cat:'Terminal', label:'History Search',icon:'🔍',color:'#7C8494', needs:'key', action:W('r',['ctrl']) },
  { id:'w.term.newTab',   cat:'Terminal', label:'New Tab',      icon:'＋', color:'#22C55E', needs:'key', action:W('t',['ctrl','shift']) },
  { id:'w.term.closeTab', cat:'Terminal', label:'Close Tab',    icon:'✕', color:'#F5A524', needs:'key', action:W('w',['ctrl','shift']) },
  { id:'w.term.splitV',   cat:'Terminal', label:'Split Pane',   icon:'▤', color:'#7C8494', needs:'key', action:W('d',['alt','shift']) },
  { id:'w.term.paste',    cat:'Terminal', label:'Paste',        icon:'⇩', color:'#4C8DFF', needs:'key', action:W('v',['ctrl','shift']) },
];

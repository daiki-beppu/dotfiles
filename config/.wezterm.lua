local wezterm = require 'wezterm'
local config = wezterm.config_builder()

config.keys = {
  {key="Enter", mods="SHIFT", action=wezterm.action{SendString="\x1b\r"}},
  -- Cmd+Shift+E でタブ名を変更
  {
    key = 'E',
    mods = 'CMD|SHIFT',
    action = wezterm.action.PromptInputLine {
      description = 'タブ名を変更',
      action = wezterm.action_callback(function(window, pane, line)
        if line then
          window:active_tab():set_title(line)
        end
      end),
    },
  },
  -- Cmd+| で縦分割（左右に分割）
  {
    key = '\\',
    mods = 'CMD|SHIFT',
    action = wezterm.action.SplitHorizontal { domain = 'CurrentPaneDomain' },
  },
  -- Cmd+- で横分割（上下に分割）
  {
    key = '-',
    mods = 'CMD',
    action = wezterm.action.SplitVertical { domain = 'CurrentPaneDomain' },
  },
}


-- 設定ファイルの自動リロードを有効化
config.automatically_reload_config = true

-- フォントサイズ
config.font_size = 11.0

-- 日本語入力（IME）を有効化
config.use_ime = true

-- ウィンドウの背景透明度（0.0〜1.0）
config.window_background_opacity = 0.85

config.macos_window_background_blur = 20

config.window_decorations = "RESIZE"

config.hide_tab_bar_if_only_one_tab = true

-- タブの最大幅を設定（タブが少ない時は広く、多い時は自動で狭くなる）
config.tab_max_width = 32

config.window_frame = {
  inactive_titlebar_bg = "none",
  active_titlebar_bg = "none",
}

local SOLID_LEFT_ARROW = wezterm.nerdfonts.ple_lower_right_triangle
local SOLID_RIGHT_ARROW = wezterm.nerdfonts.ple_upper_left_triangle

config.window_background_gradient = {
  colors = { "#000000" }
}

config.show_new_tab_button_in_tab_bar = false
config.colors = {
   cursor_bg = '#EEEEEE',     -- カーソルの背景色（緑系）
   cursor_fg = 'black',       -- カーソル内のテキスト色
   cursor_border = '#EEEEEE', -- カーソルの枠線色
   tab_bar = {
     inactive_tab_edge = "none",
   },
 }

wezterm.on("format-tab-title", function(tab, tabs, panes, config, hover, max_width)
  local background = "#5c6d74"
  local foreground = "#FFFFFF"
  local edge_background = "none"

  if tab.is_active then
    background = "#ae8b2d"
    foreground = "#FFFFFF"
  end

  local edge_foreground = background

  -- タイトルの優先順位：
  -- 1. 手動設定したタブタイトル (Cmd+Shift+Eで設定したもの)
  -- 2. ペインのタイトル (シェルから設定されたもの)
  local title = tab.tab_title
  if not title or #title == 0 then
    title = tab.active_pane.title
  end
  title = " " .. wezterm.truncate_right(title, max_width - 1) .. " "

  return {
    { Background = { Color = edge_background } },
    { Foreground = { Color = edge_foreground } },
    { Text = SOLID_LEFT_ARROW },
    { Background = { Color = background } },
    { Foreground = { Color = foreground } },
    { Text = title },
    { Background = { Color = edge_background } },
    { Foreground = { Color = edge_foreground } },
    { Text = SOLID_RIGHT_ARROW },
  }
end)

-- 起動時にウィンドウを最大化
wezterm.on('gui-startup', function(cmd)
  local tab, pane, window = wezterm.mux.spawn_window(cmd or {})
  window:gui_window():maximize()
end)

return config

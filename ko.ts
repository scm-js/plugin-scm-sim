// Korean for every string the plugin shows; English is the key. What the engine says itself is shown as it comes.
// `tests/ko.test.ts` fails on a `t("…")` in the source with no entry here, and on an entry nothing uses.
export const KO: Record<string, string> = {
  "Another map was started in its place.": "그 자리에 다른 맵이 시작되었습니다.",
  "Asking the engine…": "엔진에 확인하는 중…",
  "Check again": "다시 확인",
  "Ready. It plays from the copy of StarCraft you gave the site.": "준비되었습니다. 사이트에 제공한 StarCraft 복사본으로 실행합니다.",
  "Ready. It plays from this development server's files.": "준비되었습니다. 이 개발 서버의 파일로 실행합니다.",
  "Ready. It plays from your StarCraft 1.16.1 files.": "준비되었습니다. 사용자의 StarCraft 1.16.1 파일로 실행합니다.",
  "Test Map in Browser": "브라우저에서 맵 테스트",
  "The browser did not let the play page open. Allow pop-ups for this site and try again.": "브라우저가 플레이 페이지를 열지 못하게 했습니다. 이 사이트의 팝업을 허용한 뒤 다시 시도하세요.",
  "The engine cannot run a game here.": "여기서는 엔진이 게임을 실행할 수 없습니다.",
  "The engine runs in your browser from your own copy of StarCraft. A replay or a map handed to it is not stored and not sent anywhere.": "엔진은 사용자의 StarCraft 복사본을 사용해 브라우저 안에서 실행됩니다. 엔진에 넘긴 리플레이나 맵은 저장되지 않으며 어디로도 전송되지 않습니다.",
  "The map is running on the play page.": "플레이 페이지에서 맵이 실행 중입니다.",
  "The play page could not start the map: {message}": "플레이 페이지에서 맵을 시작하지 못했습니다: {message}",
  "The engine was closed before it finished.": "엔진이 끝나기 전에 닫혔습니다.",
  "The engine's page did not answer.": "엔진 페이지가 응답하지 않았습니다.",
  "There is no map to play.": "플레이할 맵이 없습니다.",
  "This browser has no copy of StarCraft to play from. Give the site your game on the Game Data page.": "이 브라우저에는 실행에 쓸 StarCraft 복사본이 없습니다. 게임 데이터 페이지에서 사이트에 게임을 제공하세요.",
  "This editor has no play page beside it, so the engine cannot be reached from here. It is at scmjs.dev.": "이 편집기에는 함께 제공되는 플레이 페이지가 없어 여기서는 엔진에 연결할 수 없습니다. 엔진은 scmjs.dev에 있습니다.",
  "scm-sim is the game engine behind the site's play page. This plugin lets other plugins use it: a replay tool can have a replay played to its end and learn what really happened in it, and a map can be started in a browser tab. Its one menu item is Tools ▸ Test Map in Browser.": "scm-sim은 사이트의 플레이 페이지를 움직이는 게임 엔진입니다. 이 플러그인은 다른 플러그인이 그 엔진을 쓸 수 있게 합니다. 리플레이 도구는 리플레이를 끝까지 실행해 실제로 일어난 일을 알아낼 수 있고, 맵을 브라우저 탭에서 시작할 수도 있습니다. 메뉴 항목은 도구 ▸ 브라우저에서 맵 테스트 하나뿐입니다.",
};

import { appPath } from '/imports/api/utility/basePath';

const style = document.createElement('style');
style.textContent = `@font-face {font-family:game-icons;src:url("${appPath('fonts/game-icons.woff')}") format("woff"),url("${appPath('fonts/game-icons.ttf')}") format("truetype");}`;
document.head.appendChild(style);

import {
  DEFAULT_THEME_PREFERENCE,
  OS_FOLLOWING_PUBLIC_PATHS,
  PREFERS_DARK_QUERY,
  THEME_ATTRIBUTE,
  THEME_COOKIE_NAME,
  THEME_PREFERENCE_ATTRIBUTE,
} from "./theme";

const AUTH_PATHS_LITERAL = JSON.stringify(OS_FOLLOWING_PUBLIC_PATHS);

/**
 * Script anti-flash, injecté en synchrone dans `<head>`.
 *
 * Il s'exécute avant la première peinture et pose `data-theme` sur `<html>`.
 * Sans lui, un compte réglé sur « Sombre » ou « Automatique » verrait le thème
 * clair pendant une frame avant l'hydratation de React.
 *
 * Il relit le cookie lui-même plutôt que de faire confiance au rendu serveur :
 * c'est la seule information disponible avant la première peinture pour
 * résoudre `system`, que le serveur ne peut pas connaître.
 *
 * Sans aucune préférence enregistrée, le défaut produit est `light`, sauf sur
 * les écrans publics d'authentification, qui suivent alors le réglage système.
 *
 * Contraintes : aucune dépendance, aucune exception qui remonte, repli
 * systématique sur le thème clair.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var d=document.documentElement;
var m=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE_NAME}=([^;]*)/);
var p=m?decodeURIComponent(m[1]):null;
if(p!=="light"&&p!=="dark"&&p!=="system"){
var b=${AUTH_PATHS_LITERAL},q=location.pathname,f=false;
for(var i=0;i<b.length;i++){if(q===b[i]||q.indexOf(b[i]+"/")===0){f=true;break;}}
p=f?"system":"${DEFAULT_THEME_PREFERENCE}";
}
var t=p==="system"?(window.matchMedia("${PREFERS_DARK_QUERY}").matches?"dark":"light"):p;
d.setAttribute("${THEME_ATTRIBUTE}",t);
d.setAttribute("${THEME_PREFERENCE_ATTRIBUTE}",p);
}catch(e){
try{document.documentElement.setAttribute("${THEME_ATTRIBUTE}","light");}catch(e2){}
}})();`;

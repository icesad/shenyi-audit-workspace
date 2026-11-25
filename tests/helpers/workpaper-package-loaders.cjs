const assert=require('node:assert/strict');
const LOADERS='<script src="workpaper-package.js"></script><script src="workpaper-package-export.js"></script>',DEPENDENCY='<script src="supplemental-workpapers.js"></script>';
function withoutWorkpaperPackageLoaders(source){
 assert.equal(source.split(LOADERS).length-1,1,'Only one exact saved-workpaper loader pair is approved');assert.equal(source.split(DEPENDENCY+LOADERS).length-1,1,'Workpaper package loaders must immediately follow the original supplemental dependency');
 for(const file of ['workpaper-package.js','workpaper-package-export.js'])assert.equal(source.split(file).length-1,1,'No alternate or repeated workpaper package loader is approved');return source.replace(LOADERS,'');
}
module.exports={withoutWorkpaperPackageLoaders,LOADERS,DEPENDENCY};

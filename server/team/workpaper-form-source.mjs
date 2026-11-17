import {dataDigest,dataConflict,SHA} from './workpaper-data-policy.mjs';
import {deny} from './http-utils.mjs';
export function workpaperFormTask(db,context,value,hash){
 if(!SHA.test(hash??''))deny();const record=value.record,candidates=[];
 const add=(archive,index,phase)=>{if(!archive)return;if(!Array.isArray(index)||index.length>2048)dataConflict();for(const file of index)if(file?.sha256===hash)candidates.push({archive,file,phase});};
 for(const source of Object.values(record.workpaperSources||{}))add(source.archive,source.index||[],source.phase);add(record.archive,record.index||[],3);add(record.riskArchive,record.riskIndex||[],4);
 const file=reference=>{if(!reference||!value.references.has(reference.sha256))dataConflict();const row=db.prepare('SELECT sha256,byte_length,bytes FROM team_workpaper_data_originals WHERE team_id=? AND project_id=? AND sha256=?').get(context.project.teamId,context.project.id,reference.sha256);if(!row||row.byte_length!==reference.bytes||row.bytes.length!==reference.bytes||dataDigest(row.bytes)!==reference.sha256)dataConflict();return row.bytes;};
 if(candidates.length){if(new Set(candidates.map(x=>/\.xlsx?$/i.test(x.file.path??x.file.name)?'excel':'word')).size!==1)dataConflict();const selected=candidates[0],path=selected.file.path??selected.file.name;if(typeof path!=='string'||!/^.+\.(?:xlsx?|docx?)$/i.test(path))deny();return{entry:true,path,fileSha256:hash,archiveSha256:selected.archive.hash,bytes:file(selected.archive.blob),strictLayout:candidates.some(x=>[5,6,7].includes(x.phase))};}
 const supplemental=(record.supplementalWorkpapers||[]).find(x=>x.file?.sha256===hash)?.file;if(!supplemental)deny();return{entry:false,path:supplemental.name,fileSha256:hash,bytes:file(supplemental.blob),strictLayout:false};
}
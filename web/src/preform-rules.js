export const CORNER_CLEARANCE=.2828;
export const TRIAL_DELTA=.15;
export const chamferFor=pad=>Math.round((2*pad+Math.SQRT2*CORNER_CLEARANCE)*100)/100;
export const trialChoices=['lower','middle','upper'];
export const emptyTrial=()=>({choice:'middle',locked:false,value:null,signature:null,confirmed_at:null});
// Design fingerprint, NOT an integrity or approval check: it is the plain text
// of the geometry inputs, so anyone editing a parameter file can reproduce it.
// It only detects that dimensions changed after a trial was locked. The field
// keeps the historical name `signature` for saved-project/Python compatibility.
// Fixed precision and ordered paths make the recorded result portable to the
// Python exporter. Metadata and the selected result are not design inputs.
export function trialSignature(d){
 const paths=['package.length','package.width','package.support_height','pcb.opening_length','pcb.opening_width','pcb.thickness','pcb.relief_diameter','copper.base_length','copper.base_width','copper.base_thickness','copper.corner_radius','copper.hole_diameter','copper.hole_edge_offset','copper.pad_size','boss.length','boss.width','boss.total_height','boss.center_from_left','boss.center_from_bottom','stack.lead_solder','stack.board_solder','stack.flange_gap','stack.pad_height','preform.chamfer'];
 return paths.map(path=>{const[g,k]=path.split('.');return `${path}=${Number(d[g][k]).toFixed(9)}`;}).join('|')+'|holes='+[...d.copper.hole_corners].sort().join(',');
}
export function trialState(d,z){
 const trials=[z-TRIAL_DELTA,z,z+TRIAL_DELTA],record=d.trial_result,signature=trialSignature(d),index=trialChoices.indexOf(record.choice);
 const valid=record.locked&&record.signature===signature&&Math.abs(record.value-trials[index])<1e-8;
 return{trials,signature,status:record.locked?(valid?'locked':'stale'):'unlocked',model:valid?record.value:trials[index]};
}

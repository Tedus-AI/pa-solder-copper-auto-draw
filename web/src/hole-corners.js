export const holeCorners={bottom_left:[-1,-1],bottom_right:[1,-1],top_left:[-1,1],top_right:[1,1]};
export const defaultHoleCorners=['bottom_left','top_right'];
export const holeMask=c=>(c.hole_corners??defaultHoleCorners).reduce((mask,key)=>mask|(1<<Object.keys(holeCorners).indexOf(key)),0);
export const holeCenters=c=>Object.keys(holeCorners).filter(key=>(c.hole_corners??defaultHoleCorners).includes(key)).map(key=>holeCorners[key].map((sign,i)=>sign*((i?c.base_width:c.base_length)/2-c.hole_edge_offset)));

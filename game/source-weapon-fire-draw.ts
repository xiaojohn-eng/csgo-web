/** The original choice between the sequences one activity of a model carries.
 *
 * A weapon model can give an activity several sequences with an `actweight` each, and
 * the engine draws one per request. The draw is a uniform integer over the summed
 * weights, so equal weights — which is what these rifle and pistol models use — give
 * every variant the same chance.
 *
 * Kept in one place: the first-person view models draw with it, and the pistol
 * viewmodel clocks draw with it, so the port has one rule rather than two.
 */
export function drawSourceActivityVariant(weights:readonly number[],random:()=>number){
 if(!weights.length)throw new Error('Original activity has no variant to draw from');
 const total=weights.reduce((sum,weight)=>sum+weight,0);
 if(!(total>0))throw new Error('Original activity variant weights sum to nothing');
 let remaining=Math.min(total-1,Math.max(0,Math.floor(random()*total)));
 for(let index=0;index<weights.length;index++){remaining-=weights[index];if(remaining<0)return index;}
 return weights.length-1;
}
/** The draw's random value, from a seed both sides already share.
 *
 * The original picks the variant on the client that fires, so the choice is local there.
 * This port keeps the pistol viewmodel clock inside the shared pose state, so authority
 * and prediction have to reach the same variant or they would disagree frame by frame.
 * The client's command seed already travels in the command stream for that reason, so
 * the draw is taken from it: one value, the same on both sides, varying per command. */
export function sourceActivityDrawValue(seed:number){
 if(!Number.isInteger(seed))throw new Error('Invalid original activity draw seed');
 let state=(seed>>>0)+0x6D2B79F5;
 state=Math.imul(state^(state>>>15),state|1);state^=state+Math.imul(state^(state>>>7),state|61);
 return ((state^(state>>>14))>>>0)/4294967296;
}

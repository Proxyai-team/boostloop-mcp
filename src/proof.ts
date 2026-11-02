export function decodeScreenshotBase64(value:string):Uint8Array<ArrayBuffer>{
 const maximum=5*1024*1024;
 if(!value.length||value.length>Math.ceil(maximum/3)*4||value.length%4!==0)throw new Error('Provide valid plain base64 for a screenshot up to 5 MB');
 const padding=value.endsWith('==')?2:value.endsWith('=')?1:0;
 const content=value.slice(0,value.length-padding);
 // A character-class scan avoids a repeated-group regex stack proportional to file size.
 if(/[^A-Za-z0-9+/]/.test(content))throw new Error('Provide plain base64 without a data URL prefix');
 const size=value.length/4*3-padding;
 if(size>maximum)throw new Error('Maximum screenshot size is 5 MB');
 const raw=atob(value),bytes=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 return bytes;
}

'use strict';
// Use the exported IL2CPP API of the verified build, never borrowed RVAs.
const ga=Process.getModuleByName('GameAssembly.dll'), nil=ptr(0);
function api(name,result,args){return new NativeFunction(ga.getExportByName('il2cpp_'+name),result,args,{exceptions:'propagate',traps:'all'});}
const A={
 domain:api('domain_get','pointer',[]),attach:api('thread_attach','pointer',['pointer']),current:api('thread_current','pointer',[]),detach:api('thread_detach','void',['pointer']),
 assemblies:api('domain_get_assemblies','pointer',['pointer','pointer']),image:api('assembly_get_image','pointer',['pointer']),
 klass:api('class_from_name','pointer',['pointer','pointer','pointer']),parent:api('class_get_parent','pointer',['pointer']),
 className:api('class_get_name','pointer',['pointer']),classNs:api('class_get_namespace','pointer',['pointer']),
 methods:api('class_get_methods','pointer',['pointer','pointer']),methodName:api('method_get_name','pointer',['pointer']),
 pc:api('method_get_param_count','uint',['pointer']),pt:api('method_get_param','pointer',['pointer','uint']),
 rt:api('method_get_return_type','pointer',['pointer']),flags:api('method_get_flags','uint',['pointer','pointer']),
 typeName:api('type_get_name','pointer',['pointer']),classType:api('class_get_type','pointer',['pointer']),typeObject:api('type_get_object','pointer',['pointer']),
 nested:api('class_get_nested_types','pointer',['pointer','pointer']),declaring:api('class_get_declaring_type','pointer',['pointer']),
 allFields:api('class_get_fields','pointer',['pointer','pointer']),fieldName:api('field_get_name','pointer',['pointer']),fieldFlags:api('field_get_flags','uint',['pointer']),
 field:api('class_get_field_from_name','pointer',['pointer','pointer']),offset:api('field_get_offset','uint64',['pointer']),
 fieldType:api('field_get_type','pointer',['pointer']),staticGet:api('field_static_get_value','void',['pointer','pointer']),
 invoke:api('runtime_invoke','pointer',['pointer','pointer','pointer','pointer']),unbox:api('object_unbox','pointer',['pointer']),
 string:api('string_new','pointer',['pointer']),enum:api('class_is_enum','bool',['pointer']),fromType:api('class_from_type','pointer',['pointer'])
};
const classes=new Map(),methods=new Map(),fields=new Map();
function klass(full){if(!full.includes('.'))full='.'+full;if(classes.has(full))return classes.get(full);const split=full.lastIndexOf('.'),ns=full.slice(0,split),name=full.slice(split+1);
 const count=Memory.alloc(8),domain=A.domain(),attached=A.current().isNull()?A.attach(domain):nil;try{const all=A.assemblies(domain,count);
 for(let i=0;i<count.readU64().toNumber();i++){const k=A.klass(A.image(all.add(i*8).readPointer()),Memory.allocUtf8String(ns),Memory.allocUtf8String(name));if(!k.isNull()){classes.set(full,k);return k;}}
 const boundary=full.lastIndexOf('.');if(boundary>0){try{const parent=klass(full.slice(0,boundary)),it=Memory.alloc(8);it.writePointer(nil);for(;;){const child=A.nested(parent,it);if(child.isNull())break;if(A.className(child).readCString()===full.slice(boundary+1)){classes.set(full,child);return child;}}}catch(_){}}
 throw Error('Class unavailable: '+full);}finally{if(!attached.isNull())A.detach(attached);}
}
function fullClassName(k){const declaring=A.declaring(k);return declaring.isNull()?A.classNs(k).readCString()+'.'+A.className(k).readCString():fullClassName(declaring)+'.'+A.className(k).readCString();}
function classSchema(full){const k=klass(full),it=Memory.alloc(8),out={name:fullClassName(k),parent:A.parent(k).isNull()?null:fullClassName(A.parent(k)),fields:[],methods:[]};
 it.writePointer(nil);for(;;){const f=A.allFields(k,it);if(f.isNull())break;out.fields.push({name:A.fieldName(f).readCString(),type:A.typeName(A.fieldType(f)).readCString(),offset:A.offset(f).toNumber(),flags:A.fieldFlags(f)});}
 it.writePointer(nil);for(;;){const m=A.methods(k,it);if(m.isNull())break;out.methods.push({name:A.methodName(m).readCString(),rva:m.readPointer().sub(ga.base).toString(),flags:A.flags(m,nil),returns:A.typeName(A.rt(m)).readCString(),parameters:Array.from({length:A.pc(m)},(_,i)=>A.typeName(A.pt(m,i)).readCString())});}return out;
}
function method(full,name,argc,signature=null){const key=JSON.stringify([full,name,argc,signature]);if(methods.has(key))return methods.get(key);
 let k=klass(full),found=[];while(!k.isNull()){
 const it=Memory.alloc(8);it.writePointer(nil);for(;;){const m=A.methods(k,it);if(m.isNull())break;if(A.methodName(m).readCString()!==name||A.pc(m)!==argc)continue;
 const params=Array.from({length:argc},(_,i)=>A.typeName(A.pt(m,i)).readCString());if(signature&&JSON.stringify(signature)!==JSON.stringify(params))continue;
 found.push({info:m,parameters:params,returns:A.typeName(A.rt(m)).readCString(),static:!!(A.flags(m,nil)&16)});}
 if(found.length)break;k=A.parent(k);}
 if(found.length!==1)throw Error('Ambiguous/unavailable method: '+key+' matches='+found.length);
 methods.set(key,found[0]);return found[0];
}
function str(p){return p.isNull()?null:p.add(20).readUtf16String(p.add(16).readS32());}
function newString(s){return A.string(Memory.allocUtf8String(s));}
function scalar(p,t){if(t==='System.Void')return null;if(t==='System.Boolean')return !!p.readU8();if(t==='System.Single')return p.readFloat();if(t==='System.Double')return p.readDouble();
 if(t==='System.Int32'||t==='System.UInt32')return p.readS32();if(t==='System.Int64')return p.readS64().toString();
 if(t==='UnityEngine.Vector2Int')return [p.readS32(),p.add(4).readS32()];if(t==='UnityEngine.Vector3')return [p.readFloat(),p.add(4).readFloat(),p.add(8).readFloat()];if(t==='UnityEngine.Vector2')return [p.readFloat(),p.add(4).readFloat()];return p.readS32();}
function isValue(t){return t.startsWith('System.')&&['Int32','UInt32','Single','Double','Boolean','Int64'].includes(t.slice(7))||t==='UnityEngine.Vector3'||t==='UnityEngine.Vector2'||t==='UnityEngine.Vector2Int'||(!t.includes('[')&&!t.includes('<')&&A.enum(klass(t.includes('.')?t:'.'+t)));}
function call(full,name,self,...values){return invoke(full,name,self,values);}
function invoke(full,name,self,values=[],signature=null){const m=method(full,name,values.length,signature),args=Memory.alloc(Math.max(8,values.length*8)),keep=[];
 values.forEach((v,i)=>{const t=m.parameters[i];let p;
  if(t.endsWith('&'))p=v;
  else if(t==='System.String')p=typeof v==='string'?newString(v):v;
  else if(typeof v==='number'||typeof v==='boolean'){p=Memory.alloc(8);if(t==='System.Single')p.writeFloat(Number(v));else if(t==='System.Double')p.writeDouble(Number(v));else p.writeS32(Number(v));}
  else if(Array.isArray(v)){p=Memory.alloc(16);v.forEach((n,i)=>p.add(i*4).writeFloat(n));}else p=v||nil;
  keep.push(p);args.add(i*8).writePointer(p);
 });
 const exc=Memory.alloc(8);exc.writePointer(nil);const result=A.invoke(m.info,m.static?nil:self,values.length?args:nil,exc);
 if(!exc.readPointer().isNull())throw Error('Native managed exception in '+full+'.'+name);
 if(m.returns==='System.Void')return null;if(result.isNull())return nil;if(m.returns==='System.String')return str(result);
 return isValue(m.returns)?scalar(A.unbox(result),m.returns):result;
}
function fieldSpec(full,name){const key=full+':'+name;if(!fields.has(key)){const f=A.field(klass(full),Memory.allocUtf8String(name));if(f.isNull())throw Error('Field unavailable: '+key);fields.set(key,{info:f,offset:A.offset(f).toNumber(),type:A.typeName(A.fieldType(f)).readCString()});}return fields.get(key);}
function read(p,full,name){const f=fieldSpec(full,name),q=p.add(f.offset);return f.type==='System.String'?str(q.readPointer()):isValue(f.type)?scalar(q,f.type):q.readPointer();}
function staticRead(full,name){const f=fieldSpec(full,name),q=Memory.alloc(32);A.staticGet(f.info,q);return f.type==='System.String'?str(q.readPointer()):isValue(f.type)?scalar(q,f.type):q.readPointer();}
function singleton(full){return staticRead(full,'Instance');}
function array(p){if(p.isNull())return [];const n=p.add(24).readU32();if(n>100000)throw Error('Invalid array length');return Array.from({length:n},(_,i)=>p.add(32+i*8).readPointer()).filter(x=>!x.isNull());}
function list(p){if(p.isNull())return [];const a=p.add(16).readPointer(),n=p.add(24).readS32();if(n<0||n>100000)throw Error('Invalid list length');return a.isNull()?[]:Array.from({length:n},(_,i)=>a.add(32+i*8).readPointer()).filter(x=>!x.isNull());}
function alive(p){return p&&!p.isNull()&&!p.add(16).readPointer().isNull();}
function objects(full){const type=A.typeObject(A.classType(klass(full)));return array(invoke('UnityEngine.Object','FindObjectsOfType',nil,[type,false],['System.Type','System.Boolean'])).filter(alive);}
function active(p){return alive(p)&&call('UnityEngine.GameObject','get_activeInHierarchy',call('UnityEngine.Component','get_gameObject',p));}
function objectName(p){return call('UnityEngine.Object','get_name',p);}
function position(p){return call('UnityEngine.Transform','get_position',call('UnityEngine.Component','get_transform',p));}
function enumName(full,value){const f=Memory.alloc(4);f.writeS32(value);const boxed=new NativeFunction(ga.getExportByName('il2cpp_value_box'),'pointer',['pointer','pointer'])(klass(full),f);return call('System.Enum','ToString',boxed);}
const taskQueue=[];
function dispatch(request){return new Promise(resolve=>{const task={request,resolve,started:false,cancelled:false};taskQueue.push(task);task.timer=setTimeout(()=>{if(!task.started){task.cancelled=true;const index=taskQueue.indexOf(task);if(index!==-1)taskQueue.splice(index,1);resolve({ok:false,error:'main_thread_unavailable',outcome:'not_started'});}},8000);});}
function installDispatcher(handler,tick=()=>{}){
 Interceptor.attach(method('.GameAPP','Update',0).info.readPointer(),{onLeave(){try{tick();}catch(e){send({tick_error:String(e)});}const task=taskQueue.shift();if(!task||task.cancelled)return;task.started=true;clearTimeout(task.timer);try{task.resolve({ok:true,result:handler(task.request)});}catch(e){task.resolve({ok:false,error:String(e)});}}});
}

// Simple slot-lease server (max 3 concurrent). Web App: Anyone with the link.
const STATE = PropertiesService.getScriptProperties();

function doGet(e){ return handle(e); }
function doPost(e){ return handle(e); }

function handle(e){
  const p = e.parameter || {};
  const token = p.token || "";
  const op = (p.op || "").toLowerCase();
  const id = p.id || "";
  const machine = p.machine || ""; // machine identifier from client
  const ttl = 120; // hardcoded: 120 seconds
  const max = clamp_(parseInt(p.max||"2",10), 1, 20); // max slots per machine, defaults to 2

  // change this to your own secret:
  const SECRET = "uzigPjtquxgsQgXE5oSRQLABN8JHtuem";
  if (token !== SECRET) return json_({ ok:false, error:"bad token" });

  // Require machine parameter for all operations except list_machines, release_all_machines, and status
  if (op !== "list_machines" && op !== "release_all_machines" && op !== "status" && !machine) {
    return json_({ ok:false, error:"machine parameter required" });
  }

  let leases = get_().filter(x => x.expiry > Date.now());

  // Save cleaned leases back to storage
  set_(leases);

  // Handle operations that don't need machine parameter first
  if (op === "list_machines"){
    // Group leases by machine and count slots per machine
    const machineMap = {};
    leases.forEach(lease => {
      if (!machineMap[lease.machine]) {
        machineMap[lease.machine] = { machine: lease.machine, count: 0, ids: [] };
      }
      machineMap[lease.machine].count++;
      machineMap[lease.machine].ids.push(lease.id);
    });

    const machines = Object.values(machineMap);
    return json_({ ok:true, total_slots:leases.length, machines:machines });
  }

  if (op === "release_all_machines"){
    // Release all slots across ALL machines (global cleanup)
    const totalReleased = leases.length;
    set_([]);
    return json_({ ok:true, released_all_machines:true, total_released:totalReleased });
  }

  if (op === "status"){
    // If no machine parameter, return all machines like list_machines
    if (!machine) {
      const machineMap = {};
      leases.forEach(lease => {
        if (!machineMap[lease.machine]) {
          machineMap[lease.machine] = { machine: lease.machine, count: 0, ids: [] };
        }
        machineMap[lease.machine].count++;
        machineMap[lease.machine].ids.push(lease.id);
      });

      const machines = Object.values(machineMap);
      return json_({ ok:true, total_slots:leases.length, machines:machines });
    }

    // If machine parameter provided, return status for that machine only
    const machineSlots = leases.filter(x => x.machine === machine);
    return json_({ ok:true, machine:machine, count:machineSlots.length, ids:machineSlots.map(x=>x.id) });
  }

  // Get machine-specific slots for operations that need machine parameter
  const machineSlots = leases.filter(x => x.machine === machine);

  if (op === "acquire"){
    // Use machine+id as unique identifier
    const i = leases.findIndex(x => x.id === id && x.machine === machine);

    if (i >= 0){
      // Renewing existing lease for this machine+id combination
      leases[i].expiry = Date.now() + ttl*1000;
      set_(leases);
      const updatedMachineSlots = leases.filter(x => x.machine === machine);
      return json_({ ok:true, granted:true, machine:machine, count:updatedMachineSlots.length, ids:updatedMachineSlots.map(x=>x.id) });
    }

    // Check if this machine has reached its limit
    if (machineSlots.length >= max) {
      return json_({ ok:true, granted:false, machine:machine, count:machineSlots.length, reason:"machine_limit", ids:machineSlots.map(x=>x.id) });
    }

    // Grant new lease (same id can exist on different machines)
    leases.push({ id, machine, expiry: Date.now() + ttl*1000 });
    set_(leases);
    const updatedMachineSlots = leases.filter(x => x.machine === machine);
    return json_({ ok:true, granted:true, machine:machine, count:updatedMachineSlots.length, ids:updatedMachineSlots.map(x=>x.id) });
  }

  if (op === "renew"){
    // Use machine+id as unique identifier
    const i = leases.findIndex(x => x.id === id && x.machine === machine);
    if (i >= 0) {
      leases[i].expiry = Date.now() + ttl*1000;
      set_(leases);
      const updatedMachineSlots = leases.filter(x => x.machine === machine);
      return json_({ ok:true, renewed:true, machine:machine, count:updatedMachineSlots.length, ids:updatedMachineSlots.map(x=>x.id) });
    }
    return json_({ ok:false, error:"lease not found" });
  }

  if (op === "release"){
    // Use machine+id as unique identifier - only release this machine's slot
    leases = leases.filter(x => !(x.id === id && x.machine === machine));
    set_(leases);
    const updatedMachineSlots = leases.filter(x => x.machine === machine);
    return json_({ ok:true, released:true, machine:machine, count:updatedMachineSlots.length, ids:updatedMachineSlots.map(x=>x.id) });
  }

  if (op === "release_all"){
    // Release all slots for THIS machine only
    leases = leases.filter(x => x.machine !== machine);
    set_(leases);
    return json_({ ok:true, released_all:true, machine:machine, count:0, ids:[] });
  }


  return json_({ ok:false, error:"unknown op" });
}

function get_(){ return JSON.parse(STATE.getProperty("leases")||"[]"); }
function set_(a){ STATE.setProperty("leases", JSON.stringify(a)); }
function json_(o){
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function clamp_(v,min,max){ return Math.max(min, Math.min(max, v)); }

// seed.js — Run once to load the Hilton family data into Supabase
// Usage: cd ~/familycrate/server && node --env-file=.env seed.js

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const FAMILY_ID = "3f71cc61-6644-41f1-a4c7-99bccecbde59";

function today() { return new Date().toISOString().slice(0, 10); }
function lastDow(dow) {
  const d = new Date(today() + "T12:00:00");
  while (d.getDay() !== dow) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
const TODAY = today();

async function seed() {
  console.log("🌱 Seeding Hilton High-5 family data...\n");

  // ── 1. Clear existing members (keep the auto-created Cliff) ────────────────
  console.log("Clearing existing members...");
  await supabase.from("members").delete().eq("family_id", FAMILY_ID);

  // ── 2. Insert all 5 family members ────────────────────────────────────────
  console.log("Adding family members...");
  const { data: members, error: mErr } = await supabase.from("members").insert([
    { family_id:FAMILY_ID, name:"Cliff",  color:"#E07830", role:"admin", email:"cliffhilton@gmail.com", sort_order:0 },
    { family_id:FAMILY_ID, name:"Ashley", color:"#3A9A5A", role:"admin", email:"",                      sort_order:1 },
    { family_id:FAMILY_ID, name:"Liv",    color:"#2A9090", role:"kid",   email:"",                      sort_order:2 },
    { family_id:FAMILY_ID, name:"Peter",  color:"#CC3A3A", role:"kid",   email:"",                      sort_order:3 },
    { family_id:FAMILY_ID, name:"Boone",  color:"#3A6ACC", role:"kid",   email:"",                      sort_order:4 },
  ]).select();
  if (mErr) { console.error("Members error:", mErr.message); process.exit(1); }

  // Build name→id map
  const mid = {};
  members.forEach(m => mid[m.name] = m.id);
  console.log("  Members:", Object.keys(mid).join(", "));

  // ── 3. Clear and insert items ──────────────────────────────────────────────
  console.log("Adding chores & groceries...");
  await supabase.from("items").delete().eq("family_id", FAMILY_ID);

  const items = [
    // All kids daily
    { text:"Morning Routine",      points:3,  category:"chores", assigned_to:[mid.Liv,mid.Peter,mid.Boone], repeat:"daily",      start_date:TODAY,      time:"7:00 AM", duration:45 },
    { text:"Read for 30 mins",     points:4,  category:"chores", assigned_to:[mid.Liv,mid.Peter,mid.Boone], repeat:"daily",      start_date:TODAY,      time:"4:00 PM", duration:30 },
    { text:"Clear dinner table",   points:5,  category:"chores", assigned_to:[mid.Liv,mid.Peter,mid.Boone], repeat:"daily",      start_date:TODAY,      time:"6:00 PM", duration:20 },
    { text:"Surprise Someone",     points:5,  category:"chores", assigned_to:[mid.Cliff,mid.Ashley,mid.Liv,mid.Peter,mid.Boone], repeat:"weekly-dow", start_date:lastDow(0), time:"2:00 PM", duration:30 },
    // Boone daily
    { text:"Kitchen floors",       points:6,  category:"chores", assigned_to:[mid.Boone], repeat:"daily", start_date:TODAY, time:"7:00 PM", duration:20 },
    { text:"Put silverware away",  points:3,  category:"chores", assigned_to:[mid.Boone], repeat:"daily", start_date:TODAY, time:"7:20 PM", duration:15 },
    { text:"Practice Fiddle",      points:4,  category:"chores", assigned_to:[mid.Boone], repeat:"daily", start_date:TODAY, time:"4:00 PM", duration:30 },
    { text:"Shoes away (garage)",  points:3,  category:"chores", assigned_to:[mid.Boone], repeat:"daily", start_date:TODAY, time:"5:00 PM", duration:15 },
    // Boone weekly
    { text:"Sort laundry",         points:5,  category:"chores", assigned_to:[mid.Boone], repeat:"weekly-dow", start_date:lastDow(0), time:"8:00 AM", duration:20 },
    { text:"Vacuum 2nd floor",     points:10, category:"chores", assigned_to:[mid.Boone], repeat:"weekly-dow", start_date:lastDow(1), time:"1:00 PM", duration:30 },
    { text:"Peter/Boone: Chores",  points:8,  category:"chores", assigned_to:[mid.Peter,mid.Boone], repeat:"weekly-dow", start_date:lastDow(2), time:"4:00 PM", duration:30 },
    { text:"Boone: Homework",      points:4,  category:"chores", assigned_to:[mid.Boone], repeat:"weekly-dow", start_date:lastDow(2), time:"5:00 PM", duration:30 },
    { text:"Dirty clothes (Boone)",points:5,  category:"chores", assigned_to:[mid.Boone], repeat:"weekly-dow", start_date:lastDow(4), time:"4:00 PM", duration:15 },
    // Peter daily
    { text:"Empty dishwasher",     points:5,  category:"chores", assigned_to:[mid.Peter], repeat:"daily", start_date:TODAY, time:"7:00 PM", duration:15 },
    { text:"Load dishwasher",      points:5,  category:"chores", assigned_to:[mid.Peter], repeat:"daily", start_date:TODAY, time:"7:15 PM", duration:15 },
    { text:"Empty trash",          points:5,  category:"chores", assigned_to:[mid.Peter], repeat:"daily", start_date:TODAY, time:"7:30 PM", duration:10 },
    // Peter weekly
    { text:"Sweep kitchen floor",  points:6,  category:"chores", assigned_to:[mid.Peter], repeat:"weekly-dow", start_date:lastDow(0), time:"9:00 AM", duration:20 },
    { text:"Take out trash",       points:8,  category:"chores", assigned_to:[mid.Peter], repeat:"weekly-dow", start_date:lastDow(0), time:"9:20 AM", duration:15 },
    // Liv weekly
    { text:"Water Plants",         points:3,  category:"chores", assigned_to:[mid.Liv], repeat:"weekly-dow", start_date:lastDow(2), time:"9:00 AM", duration:15 },
    { text:"Toilets - Kids Bath",  points:10, category:"chores", assigned_to:[mid.Liv], repeat:"weekly-dow", start_date:lastDow(6), time:"9:00 AM", duration:30 },
    { text:"Your Laundry",         points:8,  category:"chores", assigned_to:[mid.Liv], repeat:"weekly-dow", start_date:lastDow(4), time:"8:00 AM", duration:30 },
    { text:"Dirty clothes (Liv)",  points:5,  category:"chores", assigned_to:[mid.Liv], repeat:"weekly-dow", start_date:lastDow(3), time:"8:00 PM", duration:15 },
    { text:"Babysit Suvir",        points:15, category:"chores", assigned_to:[mid.Liv], repeat:"weekly-dow", start_date:lastDow(3), time:"6:00 PM", duration:90 },
    // All kids Saturday
    { text:"Deep clean something", points:12, category:"chores", assigned_to:[mid.Liv,mid.Peter,mid.Boone], repeat:"weekly-dow", start_date:lastDow(6), time:"1:00 PM", duration:60, note:"Ask mom or dad what to deep clean" },
    // Groceries
    { text:"Oat milk",      points:0, category:"groceries", assigned_to:[], repeat:"none", date:TODAY },
    { text:"Eggs",          points:0, category:"groceries", assigned_to:[], repeat:"none", date:TODAY },
    { text:"Bread",         points:0, category:"groceries", assigned_to:[], repeat:"none", date:TODAY },
    { text:"Apples",        points:0, category:"groceries", assigned_to:[], repeat:"none", date:TODAY },
    { text:"Peanut butter", points:0, category:"groceries", assigned_to:[], repeat:"none", date:TODAY },
    { text:"Chicken",       points:0, category:"groceries", assigned_to:[], repeat:"none", date:TODAY },
    { text:"Dog food",      points:0, category:"groceries", assigned_to:[mid.Cliff], repeat:"none", date:TODAY },
  ].map(i => ({ ...i, family_id: FAMILY_ID }));

  const { error: iErr } = await supabase.from("items").insert(items);
  if (iErr) console.error("Items error:", iErr.message);
  else console.log(`  ${items.length} items added`);

  // ── 4. Clear and insert events ─────────────────────────────────────────────
  console.log("Adding events & schedule...");
  await supabase.from("events").delete().eq("family_id", FAMILY_ID);

  const events = [
    // Family
    { title:"Bible Study / Lit Reading", member_ids:[mid.Cliff,mid.Ashley,mid.Liv,mid.Peter,mid.Boone], time:"7:00 AM", duration:60, type:"school", color:"#7A8FA0", repeat:"weekly-dow", start_date:lastDow(2) },
    { title:"Bible Study / Lit Reading", member_ids:[mid.Cliff,mid.Ashley,mid.Liv,mid.Peter,mid.Boone], time:"7:00 AM", duration:60, type:"school", color:"#7A8FA0", repeat:"weekly-dow", start_date:lastDow(4) },
    { title:"All: Notgrass",             member_ids:[mid.Cliff,mid.Ashley,mid.Liv,mid.Peter,mid.Boone], time:"8:00 AM", duration:60, type:"school", color:"#7A8FA0", repeat:"weekly-dow", start_date:lastDow(6) },
    // Peter
    { title:"Peter: HLCS",               member_ids:[mid.Peter], time:"8:00 AM",  duration:420, type:"school",   color:"#CC3A3A", repeat:"weekly-dow", start_date:lastDow(1) },
    { title:"Peter: Latin",              member_ids:[mid.Peter], time:"8:00 AM",  duration:60,  type:"school",   color:"#CC3A3A", repeat:"weekly-dow", start_date:lastDow(2) },
    { title:"Ashley/Peter: Break",       member_ids:[mid.Ashley,mid.Peter], time:"9:00 AM", duration:45, type:"school", color:"#7A8FA0", repeat:"weekly-dow", start_date:lastDow(2) },
    { title:"Peter: Comp & FMMA",        member_ids:[mid.Peter], time:"10:00 AM", duration:60,  type:"school",   color:"#CC3A3A", repeat:"weekly-dow", start_date:lastDow(2) },
    { title:"Peter/Olivia: Math",        member_ids:[mid.Liv,mid.Peter], time:"11:00 AM", duration:60, type:"school", color:"#7A8FA0", repeat:"weekly-dow", start_date:lastDow(2) },
    { title:"Lunch / Read aloud",        member_ids:[mid.Ashley,mid.Liv,mid.Peter], time:"12:00 PM", duration:60, type:"school", color:"#7A8FA0", repeat:"weekly-dow", start_date:lastDow(2) },
    { title:"Olivia/Peter: Reading",     member_ids:[mid.Liv,mid.Peter], time:"1:00 PM", duration:60, type:"school", color:"#7A8FA0", repeat:"weekly-dow", start_date:lastDow(2) },
    { title:"Liv to Piano & YMCA",       member_ids:[mid.Ashley,mid.Liv,mid.Peter], time:"2:00 PM", duration:90, type:"activity", color:"#7A8FA0", repeat:"weekly-dow", start_date:lastDow(2) },
    { title:"Peter: Latin & Math",       member_ids:[mid.Peter], time:"8:00 AM",  duration:60,  type:"school",   color:"#CC3A3A", repeat:"weekly-dow", start_date:lastDow(3) },
    { title:"Peter: Comp & FMMA",        member_ids:[mid.Peter], time:"9:00 AM",  duration:60,  type:"school",   color:"#CC3A3A", repeat:"weekly-dow", start_date:lastDow(3) },
    { title:"Sons & Daughters",          member_ids:[mid.Ashley,mid.Peter], time:"10:00 AM", duration:120, type:"activity", color:"#7A8FA0", repeat:"weekly-dow", start_date:lastDow(3) },
    { title:"Peter: Latin",              member_ids:[mid.Peter], time:"9:00 AM",  duration:60,  type:"school",   color:"#CC3A3A", repeat:"weekly-dow", start_date:lastDow(4) },
    { title:"Leave for Drums",           member_ids:[mid.Ashley,mid.Liv,mid.Peter], time:"10:00 AM", duration:30, type:"activity", color:"#7A8FA0", repeat:"weekly-dow", start_date:lastDow(4) },
    { title:"Peter/Ashley: Drums",       member_ids:[mid.Ashley,mid.Peter], time:"11:00 AM", duration:60, type:"activity", color:"#7A8FA0", repeat:"weekly-dow", start_date:lastDow(4) },
    { title:"Home / Lunch / Read",       member_ids:[mid.Ashley,mid.Liv,mid.Peter], time:"12:00 PM", duration:60, type:"school", color:"#7A8FA0", repeat:"weekly-dow", start_date:lastDow(4) },
    { title:"Peter: Comp",               member_ids:[mid.Peter], time:"1:00 PM",  duration:60,  type:"school",   color:"#CC3A3A", repeat:"weekly-dow", start_date:lastDow(4) },
    { title:"Peter: FMMA",               member_ids:[mid.Peter], time:"3:00 PM",  duration:60,  type:"activity", color:"#CC3A3A", repeat:"weekly-dow", start_date:lastDow(4) },
    { title:"Peter/Ashley: Latin Video", member_ids:[mid.Ashley,mid.Peter], time:"8:00 AM", duration:60, type:"school", color:"#7A8FA0", repeat:"weekly-dow", start_date:lastDow(5) },
    { title:"FMMA Reading",              member_ids:[mid.Ashley,mid.Peter], time:"9:00 AM", duration:60, type:"school", color:"#7A8FA0", repeat:"weekly-dow", start_date:lastDow(5) },
    // Boone
    { title:"Boone: HLS", member_ids:[mid.Boone], time:"8:00 AM", duration:420, type:"school", color:"#3A6ACC", repeat:"weekly-dow", start_date:lastDow(2) },
    { title:"Boone: HLS", member_ids:[mid.Boone], time:"8:00 AM", duration:420, type:"school", color:"#3A6ACC", repeat:"weekly-dow", start_date:lastDow(3) },
    { title:"Boone: HLS", member_ids:[mid.Boone], time:"8:00 AM", duration:420, type:"school", color:"#3A6ACC", repeat:"weekly-dow", start_date:lastDow(4) },
    { title:"Boone: HLS", member_ids:[mid.Boone], time:"8:00 AM", duration:420, type:"school", color:"#3A6ACC", repeat:"weekly-dow", start_date:lastDow(5) },
    { title:"Ashley/Boone: YMCA",   member_ids:[mid.Ashley,mid.Boone], time:"9:00 AM",  duration:90,  type:"activity", color:"#7A8FA0", repeat:"weekly-dow", start_date:lastDow(1) },
    { title:"Ashley: Run Errands",  member_ids:[mid.Ashley],           time:"10:30 AM", duration:60,  type:"activity", color:"#3A9A5A", repeat:"weekly-dow", start_date:lastDow(1) },
    { title:"Ashley/Boone: Fiddle", member_ids:[mid.Ashley,mid.Boone], time:"12:00 PM", duration:60,  type:"activity", color:"#7A8FA0", repeat:"weekly-dow", start_date:lastDow(1) },
    // Liv
    { title:"Olivia: HLCS",  member_ids:[mid.Liv], time:"11:00 AM", duration:300, type:"school",   color:"#2A9090", repeat:"weekly-dow", start_date:lastDow(1) },
    { title:"Olivia: Piano", member_ids:[mid.Liv], time:"8:00 AM",  duration:60,  type:"school",   color:"#2A9090", repeat:"weekly-dow", start_date:lastDow(2) },
    { title:"Olivia: GEO",   member_ids:[mid.Liv], time:"9:00 AM",  duration:60,  type:"school",   color:"#2A9090", repeat:"weekly-dow", start_date:lastDow(2) },
    { title:"Liv Piano",     member_ids:[mid.Liv], time:"2:00 PM",  duration:60,  type:"activity", color:"#2A9090", repeat:"weekly-dow", start_date:lastDow(2) },
    { title:"CKY Track",     member_ids:[mid.Liv], time:"6:00 PM",  duration:90,  type:"activity", color:"#8A7840", repeat:"weekly-dow", start_date:lastDow(2) },
    { title:"Olivia: CEC",   member_ids:[mid.Liv], time:"9:00 AM",  duration:300, type:"school",   color:"#2A9090", repeat:"weekly-dow", start_date:lastDow(3) },
    { title:"Olivia: Drama", member_ids:[mid.Liv], time:"2:00 PM",  duration:60,  type:"school",   color:"#2A9090", repeat:"weekly-dow", start_date:lastDow(3) },
    { title:"Olivia: DT",    member_ids:[mid.Liv], time:"4:00 PM",  duration:60,  type:"school",   color:"#2A9090", repeat:"weekly-dow", start_date:lastDow(3) },
    { title:"Olivia: Math",  member_ids:[mid.Liv], time:"8:00 AM",  duration:60,  type:"school",   color:"#2A9090", repeat:"weekly-dow", start_date:lastDow(4) },
    { title:"CKY Track",     member_ids:[mid.Liv], time:"6:00 PM",  duration:90,  type:"activity", color:"#8A7840", repeat:"weekly-dow", start_date:lastDow(4) },
    { title:"Olivia: HLCS",  member_ids:[mid.Liv], time:"8:00 AM",  duration:300, type:"school",   color:"#2A9090", repeat:"weekly-dow", start_date:lastDow(5) },
  ].map(e => ({ ...e, family_id: FAMILY_ID }));

  const { error: eErr } = await supabase.from("events").insert(events);
  if (eErr) console.error("Events error:", eErr.message);
  else console.log(`  ${events.length} events added`);

  // ── 5. Insert rewards ──────────────────────────────────────────────────────
  console.log("Adding rewards...");
  await supabase.from("rewards").delete().eq("family_id", FAMILY_ID);
  const { error: rErr } = await supabase.from("rewards").insert([
    { family_id:FAMILY_ID, title:"30 min extra screen time", points:10, icon:"screen" },
    { family_id:FAMILY_ID, title:"Pick dinner",              points:8,  icon:"dinner" },
    { family_id:FAMILY_ID, title:"Stay up 30 min late",      points:12, icon:"late"   },
    { family_id:FAMILY_ID, title:"Movie night pick",         points:15, icon:"movie"  },
    { family_id:FAMILY_ID, title:"Skip one chore",           points:20, icon:"skip"   },
    { family_id:FAMILY_ID, title:"Cash out $5",              points:20, icon:"cash"   },
  ]);
  if (rErr) console.error("Rewards error:", rErr.message);
  else console.log("  6 rewards added");

  // ── 6. Update family name ──────────────────────────────────────────────────
  await supabase.from("families").update({ family_name: "Hilton High-5" }).eq("id", FAMILY_ID);

  console.log("\n✅ Done! Hilton High-5 is ready to go.");
  console.log("   Refresh the app and you should see everyone.\n");
}

seed().catch(console.error);

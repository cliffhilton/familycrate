import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  apiLogin, apiLogout, apiMe, apiGetFamily,
  apiAddMember, apiUpdateMember, apiDeleteMember,
  apiAddItem, apiUpdateItem, apiDeleteItem,
  apiAddEvent, apiUpdateEvent, apiDeleteEvent,
  apiToggleDone,
  apiAddReward, apiUpdateReward, apiDeleteReward,
  apiRedeem, apiApproveRedeem, apiDeclineRedeem,
  apiUpdateSettings,
} from "./api.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() { return Date.now() + Math.floor(Math.random() * 99999); }
function getMember(members, id) { return members.find(m => m.id === id) || null; }
function dateStr(d) { return d.toISOString().slice(0, 10); }
function addDays(ds, n) { const d = new Date(ds + "T12:00:00"); d.setDate(d.getDate() + n); return dateStr(d); }
function startOfWeek(ds) { const d = new Date(ds + "T12:00:00"); d.setDate(d.getDate() - d.getDay()); return dateStr(d); }
function isoToDisplay(ds, opts) { return new Date(ds + "T12:00:00").toLocaleDateString("en-US", opts || { weekday:"short", month:"short", day:"numeric" }); }
function getDow(ds) { return new Date(ds + "T12:00:00").getDay(); }
const TODAY = dateStr(new Date());
const PERIOD_START = addDays(TODAY, -14);

function timeToMinutes(t) {
  if (!t) return -1;
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return -1;
  let h = parseInt(m[1]), min = parseInt(m[2]);
  const pm = m[3].toUpperCase() === "PM";
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  return h * 60 + min;
}
function minutesToTime12(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2,"0")} ${ampm}`;
}
const TIME_OPTIONS = [];
for (let m = 360; m <= 1320; m += 15) TIME_OPTIONS.push(minutesToTime12(m));

const DAY_START = 6 * 60;
const DAY_END   = 22 * 60;
const HOUR_PX   = 64;
const MIN_PX    = HOUR_PX / 60;
function minutesToTop(m) { return (m - DAY_START) * MIN_PX; }
function durationToPx(d) { return Math.max(d * MIN_PX, 22); }

// ─── Recurrence ───────────────────────────────────────────────────────────────
function appearsOnDate(item, ds) {
  if (!item.repeat || item.repeat === "none") return item.date === ds;
  if (!item.startDate || ds < item.startDate) return false;
  const start = new Date(item.startDate + "T12:00:00");
  const target = new Date(ds + "T12:00:00");
  const diff = Math.round((target - start) / 86400000);
  if (item.repeat === "daily") return diff >= 0;
  if (item.repeat === "weekly-dow") return target.getDay() === start.getDay() && diff >= 0;
  if (item.repeat === "monthly") return target.getDate() === start.getDate() && diff >= 0;
  return false;
}
function eventAppearsOn(ev, ds) {
  if (!ev.repeat || ev.repeat === "none") return ev.date === ds;
  if (!ev.startDate || ds < ev.startDate) return false;
  const start = new Date(ev.startDate + "T12:00:00");
  const target = new Date(ds + "T12:00:00");
  const diff = Math.round((target - start) / 86400000);
  if (ev.repeat === "daily") return diff >= 0;
  if (ev.repeat === "weekly-dow") return target.getDay() === start.getDay() && diff >= 0;
  if (ev.repeat === "monthly") return target.getDate() === start.getDate() && diff >= 0;
  return false;
}
function doneKey(itemId, memberId, ds) { return `${itemId}__${memberId}__${ds}`; }
function lastDow(dow) {
  const d = new Date(TODAY + "T12:00:00");
  while (d.getDay() !== dow) d.setDate(d.getDate() - 1);
  return dateStr(d);
}

// ─── Layout ───────────────────────────────────────────────────────────────────
function layoutBlocks(blocks) {
  if (!blocks.length) return blocks;
  const sorted = [...blocks].sort((a, b) => a.top - b.top || a.height - b.height);
  const overlaps = (a, b) => a.top < b.top + b.height - 2 && b.top < a.top + a.height - 2;

  // Greedy column assignment — place each block in the leftmost free column
  // columns tracks the bottom edge of each active column
  const columns = []; // columns[i] = bottom edge of that column

  sorted.forEach(block => {
    // Find a column whose bottom edge is at or above this block's top
    let placed = false;
    for (let c = 0; c < columns.length; c++) {
      if (columns[c] <= block.top + 2) {
        block.col = c;
        columns[c] = block.top + block.height;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Need a new column
      block.col = columns.length;
      columns.push(block.top + block.height);
    }
  });

  // Now go back and set totalCols for each block based on how many columns
  // exist in its time window (so overlapping blocks know how wide to be)
  sorted.forEach(block => {
    // Count how many columns are "active" (have a block overlapping this block)
    let maxCol = block.col;
    sorted.forEach(other => {
      if (other !== block && overlaps(block, other)) {
        maxCol = Math.max(maxCol, other.col);
      }
    });
    block.totalCols = Math.min(maxCol + 1, 3);
    block.col = Math.min(block.col, block.totalCols - 1);
  });

  return sorted;
}

// ─── Colors ───────────────────────────────────────────────────────────────────
const SCHOOL_COLOR = "#7A8FA0";
const CKY_COLOR    = "#8A7840";
const SHARED_COLOR = "#6A7A8A";
const MEMBER_COLORS = { 1:"#E07830", 2:"#3A9A5A", 3:"#2A9090", 4:"#CC3A3A", 5:"#3A6ACC" };

// ─── Seed Data ────────────────────────────────────────────────────────────────
const INIT_MEMBERS = [
  { id:1, name:"Cliff",  color:MEMBER_COLORS[1], photo:null, email:"" },
  { id:2, name:"Ashley", color:MEMBER_COLORS[2], photo:null, email:"" },
  { id:3, name:"Liv",    color:MEMBER_COLORS[3], photo:null, email:"" },
  { id:4, name:"Peter",  color:MEMBER_COLORS[4], photo:null, email:"" },
  { id:5, name:"Boone",  color:MEMBER_COLORS[5], photo:null, email:"" },
];
const INIT_ITEMS = [
  { id:1001, text:"Morning Routine",     points:3,  category:"chores", assignedTo:[3,4,5], repeat:"daily",      startDate:TODAY,      time:"7:00 AM",  duration:45 },
  { id:1002, text:"Read for 30 mins",    points:4,  category:"chores", assignedTo:[3,4,5], repeat:"daily",      startDate:TODAY,      time:"4:00 PM",  duration:30 },
  { id:1003, text:"Clear dinner table",  points:5,  category:"chores", assignedTo:[3,4,5], repeat:"daily",      startDate:TODAY,      time:"6:00 PM",  duration:20 },
  { id:1004, text:"Surprise Someone",    points:5,  category:"chores", assignedTo:[1,2,3,4,5], repeat:"weekly-dow", startDate:lastDow(0), time:"2:00 PM", duration:30 },
  { id:2001, text:"Kitchen floors",      points:6,  category:"chores", assignedTo:[5], repeat:"daily", startDate:TODAY, time:"7:00 PM", duration:20 },
  { id:2002, text:"Put silverware away", points:3,  category:"chores", assignedTo:[5], repeat:"daily", startDate:TODAY, time:"7:20 PM", duration:15 },
  { id:2003, text:"Practice Fiddle",     points:4,  category:"chores", assignedTo:[5], repeat:"daily", startDate:TODAY, time:"4:00 PM", duration:30 },
  { id:2004, text:"Shoes away",          points:3,  category:"chores", assignedTo:[5], repeat:"daily", startDate:TODAY, time:"5:00 PM", duration:15 },
  { id:2010, text:"Sort laundry",        points:5,  category:"chores", assignedTo:[5], repeat:"weekly-dow", startDate:lastDow(0), time:"8:00 AM", duration:20 },
  { id:2011, text:"Vacuum 2nd floor",    points:10, category:"chores", assignedTo:[5], repeat:"weekly-dow", startDate:lastDow(1), time:"1:00 PM", duration:30 },
  { id:2012, text:"Peter/Boone: Chores", points:8,  category:"chores", assignedTo:[4,5], repeat:"weekly-dow", startDate:lastDow(2), time:"4:00 PM", duration:30 },
  { id:2013, text:"Boone: Homework",     points:4,  category:"chores", assignedTo:[5], repeat:"weekly-dow", startDate:lastDow(2), time:"5:00 PM", duration:30 },
  { id:3001, text:"Empty dishwasher",    points:5,  category:"chores", assignedTo:[4], repeat:"daily", startDate:TODAY, time:"7:00 PM", duration:15 },
  { id:3002, text:"Load dishwasher",     points:5,  category:"chores", assignedTo:[4], repeat:"daily", startDate:TODAY, time:"7:15 PM", duration:15 },
  { id:3003, text:"Empty trash",         points:5,  category:"chores", assignedTo:[4], repeat:"daily", startDate:TODAY, time:"7:30 PM", duration:10 },
  { id:3010, text:"Sweep kitchen floor", points:6,  category:"chores", assignedTo:[4], repeat:"weekly-dow", startDate:lastDow(0), time:"9:00 AM", duration:20 },
  { id:3011, text:"Take out trash",      points:8,  category:"chores", assignedTo:[4], repeat:"weekly-dow", startDate:lastDow(0), time:"9:20 AM", duration:15 },
  { id:4001, text:"Water Plants",        points:3,  category:"chores", assignedTo:[3], repeat:"weekly-dow", startDate:lastDow(2), time:"9:00 AM", duration:15 },
  { id:4010, text:"Toilets - Kids Bath", points:10, category:"chores", assignedTo:[3], repeat:"weekly-dow", startDate:lastDow(6), time:"9:00 AM", duration:30 },
  { id:4011, text:"Your Laundry",        points:8,  category:"chores", assignedTo:[3], repeat:"weekly-dow", startDate:lastDow(4), time:"8:00 AM", duration:30 },
  { id:4013, text:"Babysit Suvir",       points:15, category:"chores", assignedTo:[3], repeat:"weekly-dow", startDate:lastDow(3), time:"6:00 PM", duration:90 },
  { id:5001, text:"Deep clean something",points:12, category:"chores", assignedTo:[3,4,5], repeat:"weekly-dow", startDate:lastDow(6), time:"1:00 PM", duration:60, note:"Ask mom or dad what to deep clean" },
  { id:6001, text:"Oat milk",  points:0, category:"groceries", assignedTo:[], repeat:"none", date:TODAY },
  { id:6002, text:"Eggs",      points:0, category:"groceries", assignedTo:[], repeat:"none", date:TODAY },
  { id:6003, text:"Bread",     points:0, category:"groceries", assignedTo:[], repeat:"none", date:TODAY },
  { id:6004, text:"Apples",    points:0, category:"groceries", assignedTo:[], repeat:"none", date:TODAY },
  { id:6005, text:"Peanut butter", points:0, category:"groceries", assignedTo:[], repeat:"none", date:TODAY },
  { id:6006, text:"Chicken",   points:0, category:"groceries", assignedTo:[], repeat:"none", date:TODAY },
  { id:6007, text:"Dog food",  points:0, category:"groceries", assignedTo:[1], repeat:"none", date:TODAY },
];
const INIT_EVENTS = [
  { id:100, title:"Bible Study / Lit Reading", memberIds:[1,2,3,4,5], time:"7:00 AM", duration:60, type:"school", color:SCHOOL_COLOR, repeat:"weekly-dow", startDate:lastDow(2) },
  { id:101, title:"Bible Study / Lit Reading", memberIds:[1,2,3,4,5], time:"7:00 AM", duration:60, type:"school", color:SCHOOL_COLOR, repeat:"weekly-dow", startDate:lastDow(4) },
  { id:102, title:"All: Notgrass",             memberIds:[1,2,3,4,5], time:"8:00 AM", duration:60, type:"school", color:SCHOOL_COLOR, repeat:"weekly-dow", startDate:lastDow(6) },
  { id:200, title:"Peter: HLCS",  memberIds:[4], time:"8:00 AM", duration:420, type:"school", color:MEMBER_COLORS[4], repeat:"weekly-dow", startDate:lastDow(1) },
  { id:210, title:"Peter: Latin", memberIds:[4], time:"8:00 AM", duration:60,  type:"school", color:MEMBER_COLORS[4], repeat:"weekly-dow", startDate:lastDow(2) },
  { id:213, title:"Peter/Olivia: Math",    memberIds:[3,4], time:"11:00 AM", duration:60, type:"school", color:SCHOOL_COLOR, repeat:"weekly-dow", startDate:lastDow(2) },
  { id:214, title:"Lunch / Read aloud",    memberIds:[2,3,4], time:"12:00 PM", duration:60, type:"school", color:SCHOOL_COLOR, repeat:"weekly-dow", startDate:lastDow(2) },
  { id:215, title:"Olivia/Peter: Reading", memberIds:[3,4], time:"1:00 PM", duration:60, type:"school", color:SCHOOL_COLOR, repeat:"weekly-dow", startDate:lastDow(2) },
  { id:216, title:"Liv to Piano & YMCA",   memberIds:[2,3,4], time:"2:00 PM", duration:90, type:"activity", color:SCHOOL_COLOR, repeat:"weekly-dow", startDate:lastDow(2) },
  { id:220, title:"Peter: Latin & Math",   memberIds:[4], time:"8:00 AM", duration:60, type:"school", color:MEMBER_COLORS[4], repeat:"weekly-dow", startDate:lastDow(3) },
  { id:222, title:"Sons & Daughters",      memberIds:[2,4], time:"10:00 AM", duration:120, type:"activity", color:SCHOOL_COLOR, repeat:"weekly-dow", startDate:lastDow(3) },
  { id:230, title:"Peter: Latin",          memberIds:[4], time:"9:00 AM", duration:60, type:"school", color:MEMBER_COLORS[4], repeat:"weekly-dow", startDate:lastDow(4) },
  { id:232, title:"Peter/Ashley: Drums",   memberIds:[2,4], time:"11:00 AM", duration:60, type:"activity", color:SCHOOL_COLOR, repeat:"weekly-dow", startDate:lastDow(4) },
  { id:234, title:"Peter: Comp",           memberIds:[4], time:"1:00 PM", duration:60, type:"school", color:MEMBER_COLORS[4], repeat:"weekly-dow", startDate:lastDow(4) },
  { id:235, title:"Peter: FMMA",           memberIds:[4], time:"3:00 PM", duration:60, type:"activity", color:MEMBER_COLORS[4], repeat:"weekly-dow", startDate:lastDow(4) },
  { id:300, title:"Boone: HLS", memberIds:[5], time:"8:00 AM", duration:420, type:"school", color:MEMBER_COLORS[5], repeat:"weekly-dow", startDate:lastDow(2) },
  { id:301, title:"Boone: HLS", memberIds:[5], time:"8:00 AM", duration:420, type:"school", color:MEMBER_COLORS[5], repeat:"weekly-dow", startDate:lastDow(3) },
  { id:302, title:"Boone: HLS", memberIds:[5], time:"8:00 AM", duration:420, type:"school", color:MEMBER_COLORS[5], repeat:"weekly-dow", startDate:lastDow(4) },
  { id:303, title:"Boone: HLS", memberIds:[5], time:"8:00 AM", duration:420, type:"school", color:MEMBER_COLORS[5], repeat:"weekly-dow", startDate:lastDow(5) },
  { id:310, title:"Ashley/Boone: YMCA",   memberIds:[2,5], time:"9:00 AM",  duration:90, type:"activity", color:SCHOOL_COLOR, repeat:"weekly-dow", startDate:lastDow(1) },
  { id:312, title:"Ashley/Boone: Fiddle", memberIds:[2,5], time:"12:00 PM", duration:60, type:"activity", color:SCHOOL_COLOR, repeat:"weekly-dow", startDate:lastDow(1) },
  { id:400, title:"Olivia: HLCS",  memberIds:[3], time:"11:00 AM", duration:300, type:"school",   color:MEMBER_COLORS[3], repeat:"weekly-dow", startDate:lastDow(1) },
  { id:410, title:"Olivia: Piano", memberIds:[3], time:"8:00 AM",  duration:60,  type:"school",   color:MEMBER_COLORS[3], repeat:"weekly-dow", startDate:lastDow(2) },
  { id:412, title:"Liv Piano",     memberIds:[3], time:"2:00 PM",  duration:60,  type:"activity", color:MEMBER_COLORS[3], repeat:"weekly-dow", startDate:lastDow(2) },
  { id:413, title:"CKY Track",     memberIds:[3], time:"6:00 PM",  duration:90,  type:"activity", color:CKY_COLOR,         repeat:"weekly-dow", startDate:lastDow(2) },
  { id:420, title:"Olivia: CEC",   memberIds:[3], time:"9:00 AM",  duration:300, type:"school",   color:MEMBER_COLORS[3], repeat:"weekly-dow", startDate:lastDow(3) },
  { id:421, title:"Olivia: Drama", memberIds:[3], time:"2:00 PM",  duration:60,  type:"school",   color:MEMBER_COLORS[3], repeat:"weekly-dow", startDate:lastDow(3) },
  { id:430, title:"Olivia: Math",  memberIds:[3], time:"8:00 AM",  duration:60,  type:"school",   color:MEMBER_COLORS[3], repeat:"weekly-dow", startDate:lastDow(4) },
  { id:433, title:"CKY Track",     memberIds:[3], time:"6:00 PM",  duration:90,  type:"activity", color:CKY_COLOR,         repeat:"weekly-dow", startDate:lastDow(4) },
  { id:440, title:"Olivia: HLCS",  memberIds:[3], time:"8:00 AM",  duration:300, type:"school",   color:MEMBER_COLORS[3], repeat:"weekly-dow", startDate:lastDow(5) },
];
const INIT_REWARDS = [
  { id:1, title:"30 min extra screen time", points:10, icon:"screen" },
  { id:2, title:"Pick dinner",              points:8,  icon:"dinner" },
  { id:3, title:"Stay up 30 min late",      points:12, icon:"late" },
  { id:4, title:"Movie night pick",         points:15, icon:"movie" },
  { id:5, title:"Skip one chore",           points:20, icon:"skip" },
  { id:6, title:"Cash out $5",              points:20, icon:"cash" },
];

const INIT_CATEGORIES = [
  { id:"chores", label:"Chores" },
  { id:"groceries", label:"Groceries" },
  { id:"todos", label:"To-Dos" },
];

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS_SHORT   = ["Su","Mo","Tu","We","Th","Fr","Sa"];

const FAVICON_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 71.6'><style>.f0{fill:#8f6a4a}.f1{fill:#333;mix-blend-mode:multiply;opacity:.2}.f2{isolation:isolate}</style><g class='f2'><g><path class='f0' d='M65.6,66.4c-19.9,0-39.6,0-59.6,0,0-19.8,0-39.6,0-59.6,19.8,0,39.5,0,59.6,0,0,19.8,0,39.5,0,59.6ZM18.3,25.3c9.7,10.1,18.8,19.6,27.4,28.7,3,0,5.3,0,7.7,0,0-2,0-3.8,0-5.5-9.6-9.9-19.2-19.8-28.6-29.4-2.3,0-4.4,0-6.5,0,0,2.5,0,4.9,0,6.2ZM56.5,18.7c0,11.8,0,24.1,0,35.3,2.5,2.7,4.5,4.9,6.6,7.1,0-16.3,0-32.7,0-49.1-2.1,2.2-4.2,4.3-6.6,6.7ZM60.7,9.4c-16.6,0-33,0-49.3,0,2.1,2.1,4.2,4.3,6.4,6.6,11.9,0,24.2,0,37,0,1.6-1.7,3.4-3.7,5.3-5.7.2-.2.3-.5.6-.9ZM11.1,63.7c16.6,0,33,0,49.4,0-2.2-2.3-4.2-4.5-6.2-6.5-12.4,0-24.7,0-36.4,0-2.4,2.3-4.5,4.3-6.8,6.5ZM8.7,11.8c0,16.6,0,33,0,49.1,2.1-2,4.2-4,6.5-6.2,0-12,0-24.3,0-36-2.3-2.4-4.4-4.5-6.5-6.8ZM46.1,19.1c0,5.8,0,11.5,0,17.3,2.3,2.2,4.8,4.6,7.2,6.9,0-7.8,0-15.9,0-24.2-2.4,0-4.6,0-7.2,0ZM18.4,54c2.8,0,5.2,0,7.8,0,0-5.2,0-10.2,0-13.9-3-3.3-5.4-5.9-7.8-8.5,0,7.5,0,14.9,0,22.5ZM42.9,19.1c-4.7,0-9.1,0-14.1,0,5,4.7,9.6,9,14.1,13.3,0-4.1,0-8.5,0-13.3ZM29.8,42.4c0,4.1,0,7.8,0,11.6,4,0,7.7,0,10.9,0-3.5-3.7-7.1-7.5-10.9-11.6Z'/><path class='f1' d='M24.8,19.1c.7.7,1.4,1.4,2.1,2.2h4.1c-.8-.7-1.5-1.4-2.3-2.1h-4Z'/><path class='f1' d='M42.9,19.1v2.1h3.3v-2.1h-3.3Z'/><path class='f1' d='M29.8,54v-2.2h-3.5v2.2h3.5Z'/><path class='f1' d='M45.6,54c-.7-.7-1.4-1.4-2.1-2.2h-4.8c.7.7,1.4,1.5,2.1,2.2h4.9Z'/></g></g></svg>`;

// ─── CSS ─────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
:root{
  --bg:#F0F4F8;--surf:#FAFCFE;--bdr:#D8E4EE;--muted:#7A96A8;
  --ink:#1A2A38;--ink2:#3A5060;
  --sky:#3A6A88;--sky-lt:#E0EEF6;--sky-bd:#A0C4DA;
  --gold:#C49A3C;--gold-lt:#FDF5DC;--gold-bd:#EDD898;
  --band:#EDF1F5;
  --sh:0 2px 12px rgba(26,42,56,.06);--sh-lg:0 8px 32px rgba(26,42,56,.13);
}
html,body{height:100%;overflow:hidden;}
body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--ink);}
::-webkit-scrollbar{width:3px;height:3px;}
::-webkit-scrollbar-thumb{background:var(--bdr);border-radius:2px;}
.app{display:flex;flex-direction:column;height:100dvh;width:100%;}

/* Header */
.hdr{display:flex;align-items:center;padding:8px 14px;background:var(--surf);border-bottom:1px solid var(--bdr);flex-shrink:0;gap:8px;box-shadow:var(--sh);}
.hdr-logo{display:flex;align-items:center;flex-shrink:0;}
.hdr-members{display:flex;gap:5px;overflow-x:auto;scrollbar-width:none;flex:1;-webkit-overflow-scrolling:touch;}
.hdr-members::-webkit-scrollbar{display:none;}
.hdr-right{display:flex;align-items:center;gap:6px;flex-shrink:0;}
.hdr-gear{background:none;border:none;cursor:pointer;padding:5px;border-radius:7px;color:var(--muted);display:flex;align-items:center;transition:all .15s;}
.hdr-gear svg{width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
.hdr-gear:hover{background:var(--sky-lt);color:var(--sky);}

/* Member chips */
.mchip{display:flex;align-items:center;gap:5px;padding:4px 10px 4px 4px;border-radius:100px;background:var(--bg);border:1.5px solid var(--bdr);cursor:pointer;transition:all .15s;position:relative;flex-shrink:0;white-space:nowrap;}
.mchip:active{transform:scale(.96);}
.mchip.active{color:#fff;border-color:transparent;}
.mchip.active .mchip-name{color:#fff;}
.mchip-name{font-size:12px;font-weight:500;color:var(--ink2);}
.mchip-pts{font-size:9px;font-weight:600;padding:2px 6px;border-radius:100px;background:var(--gold);color:#fff;margin-left:2px;white-space:nowrap;}
.mchip.active .mchip-pts{background:rgba(0,0,0,.15);}
.all-chip{display:flex;align-items:center;padding:4px 12px;border-radius:100px;background:var(--bg);border:1.5px solid var(--bdr);cursor:pointer;font-size:12px;font-weight:500;color:var(--ink2);transition:all .15s;flex-shrink:0;}
.all-chip.active{background:var(--sky);border-color:var(--sky);color:#fff;}

/* Mobile hamburger */
.ham-btn{background:none;border:none;cursor:pointer;padding:5px;color:var(--ink2);display:flex;flex-direction:column;gap:4px;align-items:center;justify-content:center;width:30px;height:30px;flex-shrink:0;}
.ham-btn span{display:block;width:16px;height:2px;background:currentColor;border-radius:1px;}
.ham-menu{position:absolute;top:calc(100%+4px);right:0;background:var(--surf);border:1px solid var(--bdr);border-radius:12px;padding:8px;box-shadow:var(--sh-lg);z-index:100;min-width:180px;display:flex;flex-direction:column;gap:3px;}
.ham-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;border:none;background:none;font-family:'DM Sans',sans-serif;font-size:13px;color:var(--ink2);width:100%;text-align:left;}
.ham-item:hover{background:var(--bg);}
.ham-item.active{background:var(--sky-lt);color:var(--sky);}

/* Nav */
.nav{display:grid;grid-template-columns:repeat(4,1fr);background:var(--surf);border-top:1px solid var(--bdr);flex-shrink:0;padding-bottom:env(safe-area-inset-bottom,0px);}
.nbtn{padding:8px 0 10px;border:none;background:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;font-family:'DM Sans',sans-serif;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;transition:color .15s;}
.nbtn.on{color:var(--sky);}
.nbtn svg{width:19px;height:19px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}

/* Page */
.page{display:flex;flex:1 1 0;min-height:0;overflow:hidden;position:relative;}

/* Calendar Drawer */
.cal-overlay{position:absolute;inset:0;background:rgba(18,32,46,.28);z-index:50;}
.cal-drawer{position:absolute;left:0;top:0;bottom:0;width:255px;background:var(--surf);border-right:1px solid var(--bdr);z-index:51;display:flex;flex-direction:column;box-shadow:var(--sh-lg);transform:translateX(-100%);transition:transform .22s cubic-bezier(.4,0,.2,1);}
.cal-drawer.open{transform:translateX(0);}
.cal-inner{padding:12px;overflow-y:auto;flex:1 1 0;}
.cal-nav-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.cal-mname{font-size:14px;font-weight:500;}
.cal-navs{display:flex;gap:3px;}
.ibtn{width:24px;height:24px;border:none;background:var(--bg);border-radius:6px;cursor:pointer;font-size:13px;color:var(--ink2);display:flex;align-items:center;justify-content:center;}
.ibtn:hover{background:var(--sky-lt);}
.cgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;margin-bottom:10px;}
.cdl{text-align:center;font-size:9px;font-weight:500;color:var(--muted);padding:2px 0;}
.cc{aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:7px;font-size:11px;cursor:pointer;position:relative;transition:all .12s;color:var(--ink2);}
.cc:hover{background:var(--sky-lt);}
.cc.today{background:var(--ink);color:#fff;font-weight:600;}
.cc.sel{background:var(--sky);color:#fff;}
.cc.other{opacity:.25;}
.cc.hasdot::after{content:'';position:absolute;bottom:2px;width:3px;height:3px;border-radius:50%;background:var(--sky);}
.cc.today.hasdot::after,.cc.sel.hasdot::after{background:rgba(255,255,255,.7);}
.up-lbl{font-size:10px;font-weight:500;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);margin-bottom:7px;}
.uev{display:flex;align-items:center;gap:7px;padding:7px 2px;border-bottom:1px solid var(--bdr);cursor:pointer;transition:background .13s;}
.uev:last-of-type{border-bottom:none;}
.uev:hover{background:var(--bg);border-radius:7px;padding-left:6px;padding-right:6px;}
.uev-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
.uev-body{flex:1;min-width:0;}
.uev-title{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.uev-when{font-size:10px;color:var(--muted);}
.add-ev-btn{display:flex;align-items:center;justify-content:center;gap:4px;width:100%;padding:7px;border:1.5px dashed var(--bdr);border-radius:8px;background:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:12px;color:var(--muted);transition:all .15s;margin-top:8px;}
.add-ev-btn:hover{border-color:var(--sky);color:var(--sky);}

/* Day View */
.day-view{flex:1 1 0;min-height:0;display:flex;flex-direction:column;overflow:hidden;}
.day-hdr{display:flex;align-items:center;gap:6px;padding:7px 12px;border-bottom:1px solid var(--bdr);flex-shrink:0;background:var(--surf);flex-wrap:wrap;}
.cal-toggle{width:28px;height:28px;border:none;background:var(--bg);border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--ink2);transition:all .15s;}
.cal-toggle:hover{background:var(--sky-lt);color:var(--sky);}
.cal-toggle svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
.day-nav-btns{display:flex;gap:2px;}
.day-title{font-size:14px;font-weight:500;flex:1;min-width:80px;}
.day-pill{padding:4px 10px;border-radius:100px;border:1.5px solid var(--bdr);background:none;font-family:'DM Sans',sans-serif;font-size:11px;cursor:pointer;color:var(--ink2);transition:all .15s;white-space:nowrap;}
.day-pill:hover{border-color:var(--sky);color:var(--sky);}
.view-toggle{display:flex;border:1.5px solid var(--bdr);border-radius:7px;overflow:hidden;}
.vt-btn{padding:4px 10px;border:none;background:none;font-family:'DM Sans',sans-serif;font-size:11px;cursor:pointer;color:var(--muted);transition:all .15s;}
.vt-btn.on{background:var(--sky);color:#fff;}
.add-dropdown{position:relative;}
.add-main-btn{padding:5px 12px;border-radius:100px;border:1.5px solid var(--sky);background:var(--sky);font-family:'DM Sans',sans-serif;font-size:12px;cursor:pointer;color:#fff;transition:all .15s;white-space:nowrap;}
.add-main-btn:hover{background:var(--ink);border-color:var(--ink);}
.add-menu{position:absolute;top:calc(100%+4px);right:0;background:var(--surf);border:1px solid var(--bdr);border-radius:10px;padding:4px;box-shadow:var(--sh-lg);z-index:100;min-width:110px;}
.add-menu-item{display:flex;align-items:center;gap:7px;padding:8px 10px;border-radius:7px;cursor:pointer;border:none;background:none;font-family:'DM Sans',sans-serif;font-size:13px;color:var(--ink2);width:100%;text-align:left;}
.add-menu-item:hover{background:var(--sky-lt);color:var(--sky);}

/* Column headers */
.col-hdrs{display:flex;border-bottom:1px solid var(--bdr);background:var(--surf);flex-shrink:0;overflow:hidden;}
.gutter-hdr{width:46px;flex-shrink:0;border-right:1px solid var(--bdr);}
.col-hdr{display:flex;align-items:center;gap:5px;padding:5px 8px;flex:1;border-right:1px solid var(--bdr);min-width:0;overflow:hidden;}
.col-hdr:last-child{border-right:none;}
.col-hdr-name{font-size:12px;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.col-hdr-pts{font-size:9px;font-weight:700;padding:2px 6px;border-radius:100px;color:#fff;white-space:nowrap;flex-shrink:0;}
.wdh{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px;flex:1;min-width:0;cursor:pointer;}
.wdh-day{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;}
.wdh-num{font-size:13px;font-weight:500;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:50%;}
.wdh-num.today-d{background:var(--sky);color:#fff;}

/* Grid */
.grid-scroll{flex:1 1 0;overflow:auto;-webkit-overflow-scrolling:touch;position:relative;}
.grid-body{display:flex;position:relative;}
.time-gutter{width:46px;flex-shrink:0;position:relative;border-right:1px solid var(--bdr);}
.time-lbl{position:absolute;right:4px;font-size:9px;color:var(--muted);line-height:1;transform:translateY(-50%);white-space:nowrap;}
.now-line{position:absolute;left:0;right:0;z-index:10;pointer-events:none;}
.now-line::before{content:'';position:absolute;left:-5px;top:-5px;width:9px;height:9px;border-radius:50%;background:#E03030;}
.now-line::after{content:'';position:absolute;left:0;right:0;top:-1px;height:2px;background:#E03030;}
.day-cols{display:flex;flex:1;position:relative;}
.pcol{flex:1;min-width:0;position:relative;border-right:1px solid var(--bdr);}
.pcol:last-child{border-right:none;}

/* Timed block */
.tblock{position:absolute;border-radius:6px;padding:3px 5px;cursor:pointer;overflow:hidden;border-left:3px solid transparent;text-align:left;transition:filter .15s,box-shadow .15s;}
.tblock:hover{filter:brightness(.92);box-shadow:0 2px 8px rgba(0,0,0,.12);}
.tblock-title{font-size:11px;font-weight:500;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tblock-time{font-size:9px;opacity:.8;margin-top:1px;}
.tblock-note{font-size:9px;opacity:.75;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tblock-chk{position:absolute;top:3px;right:3px;width:13px;height:13px;border-radius:3px;border:1.5px solid rgba(255,255,255,.5);background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;}
.tblock-chk.on{background:rgba(255,255,255,.35);border-color:rgba(255,255,255,.85);}

/* Weekend toggle */
.weekend-toggle{display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:8px;border:1.5px solid var(--bdr);background:none;font-family:'DM Sans',sans-serif;font-size:11px;cursor:pointer;color:var(--ink2);transition:all .15s;white-space:nowrap;}
.weekend-toggle.on{background:var(--sky-lt);border-color:var(--sky);color:var(--sky);}

/* Lists */
.lists-page{flex:1 1 0;min-height:0;display:flex;flex-direction:column;overflow:hidden;}
.ltabs{display:flex;padding:0 14px;background:var(--surf);border-bottom:1px solid var(--bdr);flex-shrink:0;}
.ltab{padding:10px 13px;border:none;background:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:13px;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s;}
.ltab.on{color:var(--sky);border-bottom-color:var(--sky);font-weight:500;}
.frow{display:flex;gap:5px;padding:7px 14px 4px;overflow-x:auto;scrollbar-width:none;flex-shrink:0;}
.frow::-webkit-scrollbar{display:none;}
.fchip{padding:4px 10px;border-radius:100px;border:1.5px solid var(--bdr);background:none;font-family:'DM Sans',sans-serif;font-size:12px;cursor:pointer;color:var(--ink2);white-space:nowrap;flex-shrink:0;transition:all .15s;display:flex;align-items:center;gap:4px;}
.fchip.on{background:var(--sky);color:#fff;border-color:var(--sky);}
.lscroll{flex:1 1 0;overflow-y:auto;padding:5px 14px;}
.li{display:flex;align-items:center;gap:7px;padding:9px 11px;background:var(--surf);border-radius:10px;margin-bottom:5px;border:1.5px solid var(--bdr);cursor:pointer;transition:all .18s;}
.li:hover{border-color:var(--sky);}
.li.done{opacity:.4;}
.li.done .li-text{text-decoration:line-through;}
.lchk{width:19px;height:19px;border-radius:5px;border:2px solid var(--bdr);background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:9px;color:#fff;transition:all .15s;}
.lchk.on{background:var(--sky);border-color:var(--sky);}
.li-body{flex:1;min-width:0;}
.li-text{font-size:13px;}
.li-meta{display:flex;align-items:center;gap:3px;margin-top:2px;flex-wrap:wrap;}
.li-who{font-size:11px;color:var(--muted);}
.li-tag{font-size:10px;color:var(--muted);background:var(--bg);padding:1px 5px;border-radius:3px;}
.li-note{font-size:10px;color:var(--gold);font-style:italic;}
.pbadge{padding:2px 7px;border-radius:100px;font-size:11px;font-weight:500;background:var(--gold-lt);color:var(--gold);border:1px solid var(--gold-bd);flex-shrink:0;white-space:nowrap;}
.labar{display:flex;gap:5px;padding:6px 14px 10px;background:var(--surf);border-top:1px solid var(--bdr);flex-shrink:0;}
.ainput{flex:1;min-width:0;padding:8px 11px;border-radius:8px;border:1.5px solid var(--bdr);background:var(--bg);font-family:'DM Sans',sans-serif;font-size:14px;color:var(--ink);outline:none;}
.ainput:focus{border-color:var(--sky);}
.ainput::placeholder{color:var(--muted);}
.pinput{width:44px;flex-shrink:0;padding:8px 4px;border-radius:8px;border:1.5px solid var(--bdr);background:var(--bg);font-family:'DM Sans',sans-serif;font-size:14px;color:var(--ink);outline:none;text-align:center;}
.abtn{flex-shrink:0;padding:8px 13px;border-radius:8px;border:none;background:var(--sky);color:#fff;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:500;cursor:pointer;}

/* Points */
.pts-page{flex:1 1 0;min-height:0;display:flex;flex-direction:column;overflow:hidden;}
.pts-scroll{flex:1 1 0;overflow-y:auto;padding:14px;}
.lbc{display:flex;align-items:center;gap:10px;padding:11px 13px;background:var(--surf);border-radius:11px;margin-bottom:7px;border:1.5px solid var(--bdr);}
.lbc-rank{font-size:18px;font-weight:300;color:var(--bdr);min-width:22px;text-align:center;}
.lbc-rank.r1{color:var(--gold);}
.lbc-rank.r2{color:#AAAAAA;}
.lbc-rank.r3{color:#B8906A;}
.lbc-info{flex:1;min-width:0;}
.lbc-name{font-size:14px;font-weight:500;}
.lbc-bar{height:4px;background:var(--bdr);border-radius:2px;margin-top:5px;overflow:hidden;}
.lbc-fill{height:100%;border-radius:2px;transition:width .7s cubic-bezier(.34,1.56,.64,1);}
.lbc-right{text-align:right;flex-shrink:0;}
.lbc-dollar{font-size:20px;font-weight:500;line-height:1;}
.lbc-pts{font-size:11px;color:var(--muted);margin-top:1px;}
.lbc-spent{font-size:10px;color:var(--muted);}
.store-title{font-size:15px;font-weight:500;margin:12px 0 3px;}
.store-sub{font-size:12px;color:var(--muted);margin-bottom:10px;}
/* reward-grid defined in reward-card block */
.reward-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:10px;}
@media(min-width:600px){.reward-grid{grid-template-columns:repeat(4,1fr);}}
.reward-card{padding:0;background:var(--surf);border-radius:12px;border:1.5px solid var(--bdr);cursor:pointer;transition:all .18s;text-align:center;overflow:hidden;display:flex;flex-direction:column;min-height:150px;}
.reward-card:hover{border-color:var(--sky);transform:translateY(-2px);box-shadow:0 6px 20px rgba(58,106,136,.18);}
.reward-card-body{flex:1;display:flex;flex-direction:column;align-items:center;padding:16px 10px 10px;}
.reward-icon{margin-bottom:10px;color:var(--sky);}
.reward-icon svg{width:28px;height:28px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
.reward-title{font-size:17px;font-weight:800;line-height:1.3;}
.reward-pts{font-size:13px;font-weight:700;padding:9px 6px;background:var(--sky);color:#fff;width:100%;margin-top:auto;}
.req-card{display:flex;align-items:center;gap:8px;padding:8px 11px;background:var(--surf);border-radius:9px;border:1.5px solid var(--bdr);margin-bottom:5px;}
.req-body{flex:1;min-width:0;}
.req-name{font-size:12px;font-weight:500;}
.req-who{font-size:11px;color:var(--muted);}
.req-actions{display:flex;gap:4px;}
.req-approve{padding:4px 9px;border-radius:6px;border:none;background:#D4EDD4;color:#2A6A2A;font-family:'DM Sans',sans-serif;font-size:11px;cursor:pointer;}
.req-decline{padding:4px 9px;border-radius:6px;border:none;background:#EDD4D4;color:#6A2A2A;font-family:'DM Sans',sans-serif;font-size:11px;cursor:pointer;}

/* Settings */
.set-page{flex:1 1 0;overflow-y:auto;padding:14px;}
.set-sec{margin-bottom:20px;}
.set-sec-title{font-size:15px;font-weight:500;margin-bottom:3px;}
.set-sec-sub{font-size:12px;color:var(--muted);margin-bottom:10px;}
.mer{display:flex;align-items:center;gap:9px;padding:10px 12px;background:var(--surf);border-radius:10px;border:1.5px solid var(--bdr);margin-bottom:5px;cursor:pointer;transition:all .15s;}
.mer:hover{border-color:var(--sky);}
.mer-info{flex:1;min-width:0;}
.mer-name{font-size:13px;font-weight:500;}
.mer-sub{font-size:11px;color:var(--muted);}
.mer-arrow{color:var(--muted);font-size:13px;}
.add-dashed{display:flex;align-items:center;justify-content:center;gap:5px;width:100%;padding:10px;border:1.5px dashed var(--bdr);border-radius:10px;background:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:13px;color:var(--muted);transition:all .15s;margin-bottom:14px;}
.add-dashed:hover{border-color:var(--sky);color:var(--sky);}
.set-row{display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surf);border-radius:10px;border:1.5px solid var(--bdr);margin-bottom:5px;}
.set-row-lbl{font-size:13px;font-weight:500;flex:1;}
.set-row-sub{font-size:11px;color:var(--muted);}
.rate-display{background:var(--gold-lt);border:2px solid var(--gold-bd);border-radius:14px;padding:18px 20px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:12px;}
.rate-display-lbl{font-size:15px;font-weight:500;}
.rate-display-val{font-size:32px;font-weight:600;color:var(--gold);}
.rate-edit-row{display:flex;align-items:center;gap:6px;}
.rsym{font-size:15px;color:var(--gold);font-weight:600;}
.rin{width:60px;padding:6px 8px;border-radius:7px;border:1.5px solid var(--gold-bd);background:#fff;font-family:'DM Sans',sans-serif;font-size:15px;font-weight:500;color:var(--ink);outline:none;text-align:center;}
.reset-btn{padding:6px 12px;border-radius:7px;border:1.5px solid var(--bdr);background:none;font-family:'DM Sans',sans-serif;font-size:12px;cursor:pointer;color:var(--ink2);}
.reset-btn:hover{border-color:#C06040;color:#C06040;}
.period-input{width:60px;padding:6px 8px;border-radius:7px;border:1.5px solid var(--bdr);background:var(--bg);font-family:'DM Sans',sans-serif;font-size:14px;color:var(--ink);outline:none;text-align:center;}
.sign-out-btn{width:100%;padding:10px;border-radius:10px;border:1.5px solid var(--bdr);background:none;font-family:'DM Sans',sans-serif;font-size:13px;cursor:pointer;color:var(--muted);margin-top:6px;transition:all .15s;}
.sign-out-btn:hover{border-color:#CC3A3A;color:#CC3A3A;}

/* Modals */
.ov{position:fixed;inset:0;background:rgba(18,30,44,.5);display:flex;align-items:flex-end;justify-content:center;z-index:200;}
@media(min-width:560px){.ov{align-items:center;padding:20px;}}
.modal{background:var(--surf);border-radius:18px 18px 0 0;padding:17px 17px calc(18px + env(safe-area-inset-bottom,0px));width:100%;max-width:500px;box-shadow:var(--sh-lg);display:flex;flex-direction:column;gap:11px;max-height:92dvh;overflow-y:auto;}
@media(min-width:560px){.modal{border-radius:16px;padding:18px;max-height:88dvh;}}
.mhandle{width:32px;height:4px;background:var(--bdr);border-radius:2px;margin:0 auto -4px;}
@media(min-width:560px){.mhandle{display:none;}}
.mtitle{font-size:15px;font-weight:600;}
.mrow{display:flex;flex-direction:column;gap:4px;}
.mlbl{font-size:11px;color:var(--muted);font-weight:500;letter-spacing:.4px;text-transform:uppercase;}
.min{padding:9px 11px;border-radius:8px;border:1.5px solid var(--bdr);background:var(--bg);font-family:'DM Sans',sans-serif;font-size:15px;color:var(--ink);outline:none;width:100%;}
.min:focus{border-color:var(--sky);}
select.min{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='7' viewBox='0 0 10 7'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%237A96A8' fill='none' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 9px center;padding-right:26px;}
.mgrid2{display:grid;grid-template-columns:1fr 1fr;gap:7px;}
.mgrid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;}
.mact{display:flex;gap:6px;justify-content:flex-end;margin-top:3px;flex-wrap:wrap;}
.mbtn-ghost{padding:9px 15px;border-radius:8px;border:1.5px solid var(--bdr);background:none;font-family:'DM Sans',sans-serif;font-size:13px;cursor:pointer;color:var(--ink2);}
.mbtn-del{padding:9px 15px;border-radius:8px;border:none;background:#F0D8D0;font-family:'DM Sans',sans-serif;font-size:13px;cursor:pointer;color:#8A3A2A;}
.mbtn-pri{padding:9px 18px;border-radius:8px;border:none;background:var(--sky);color:#fff;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;cursor:pointer;}
.mbtn-pri:hover{background:var(--ink);}
.mbtn-pri:active,.mbtn-ghost:active,.mbtn-del:active{transform:scale(.97);}
.ag{display:flex;flex-wrap:wrap;gap:5px;}
.ac{padding:5px 10px;border-radius:100px;border:1.5px solid var(--bdr);background:none;font-family:'DM Sans',sans-serif;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:4px;white-space:nowrap;transition:all .13s;color:var(--ink2);}
.ac.on{background:var(--sky);color:#fff;border-color:var(--sky);}
.photo-input{display:none;}
.photo-btn{padding:6px 10px;border-radius:7px;border:1.5px solid var(--bdr);background:none;font-family:'DM Sans',sans-serif;font-size:12px;cursor:pointer;color:var(--ink2);}

/* Password toggle */
.pw-wrap{position:relative;}
.pw-wrap .min{padding-right:40px;}
.pw-eye{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--muted);display:flex;align-items:center;padding:2px;}
.pw-eye:hover{color:var(--sky);}
.pw-eye svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}

/* Mobile */
@media(max-width:660px){
  .hdr{padding:7px 10px;}
  .pcol{min-width:calc(42vw);}
  .col-hdr{min-width:calc(42vw);}
  .lscroll{padding:5px 12px;}
  .frow,.ltabs,.labar{padding-left:12px;padding-right:12px;}
  .pts-scroll,.set-page{padding:12px;}
  .day-hdr{gap:4px;}
  .hide-mobile{display:none;}
}
`;

// ─── Reward Icons (no emojis) ─────────────────────────────────────────────────
const REWARD_ICONS = {
  screen: <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
  dinner: <svg viewBox="0 0 24 24"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>,
  late:   <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  movie:  <svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>,
  skip:   <svg viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  cash:   <svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  gift:   <svg viewBox="0 0 24 24"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>,
};
function RewardIcon({ icon }) {
  return <div className="reward-icon">{REWARD_ICONS[icon] || REWARD_ICONS.gift}</div>;
}

// ─── Logo ─────────────────────────────────────────────────────────────────────
const LogoSVG = ({ height = 26 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 248.3 71.6" style={{height,width:"auto"}}>
    <defs><style>{`.l0{fill:#8f6a4a}.l1{fill:#333;mix-blend-mode:multiply;opacity:.2}.l2{isolation:isolate}.l3{fill:#8b6b51}`}</style></defs>
    <g className="l2"><g><g>
      <path className="l3" d="M84.4,32.2h-2.8v12.7h-4.1v-12.7h-1.8v-3.3h1.8v-.8c0-2,.6-3.4,1.7-4.3,1.1-.9,2.8-1.4,5.1-1.3v3.4c-1,0-1.7.1-2.1.5-.4.3-.6,1-.6,1.9v.7h2.8v3.3Z"/>
      <path className="l3" d="M86.5,32.5c.6-1.3,1.5-2.2,2.6-2.9,1.1-.7,2.3-1,3.7-1s2.2.2,3.1.7c.9.5,1.6,1.1,2.2,1.8v-2.3h4.1v16h-4.1v-2.3c-.5.8-1.2,1.4-2.2,1.9-.9.5-2,.7-3.2.7s-2.6-.3-3.7-1c-1.1-.7-2-1.7-2.6-2.9-.6-1.3-1-2.7-1-4.3s.3-3.1,1-4.3ZM97.6,34.3c-.4-.7-.9-1.2-1.6-1.6-.7-.4-1.4-.6-2.1-.6s-1.4.2-2.1.5c-.6.4-1.2.9-1.5,1.6-.4.7-.6,1.5-.6,2.5s.2,1.8.6,2.5c.4.7.9,1.3,1.6,1.7.6.4,1.3.6,2.1.6s1.5-.2,2.1-.6c.7-.4,1.2-.9,1.6-1.6.4-.7.6-1.5.6-2.5s-.2-1.8-.6-2.5Z"/>
      <path className="l3" d="M130.6,30.4c1.2,1.2,1.8,2.9,1.8,5v9.4h-4v-8.8c0-1.3-.3-2.2-1-2.9-.6-.7-1.5-1-2.6-1s-2,.3-2.6,1c-.6.7-1,1.6-1,2.9v8.8h-4v-8.8c0-1.3-.3-2.2-1-2.9-.6-.7-1.5-1-2.6-1s-2,.3-2.6,1c-.6.7-1,1.6-1,2.9v8.8h-4v-16h4v1.9c.5-.7,1.2-1.2,2-1.6.8-.4,1.7-.6,2.7-.6s2.4.3,3.4.8c1,.5,1.7,1.3,2.3,2.3.5-.9,1.3-1.7,2.3-2.2,1-.6,2.1-.8,3.2-.8,2,0,3.5.6,4.8,1.8Z"/>
      <path className="l3" d="M136.2,26.3c-.5-.5-.7-1-.7-1.7s.2-1.2.7-1.7c.5-.5,1.1-.7,1.8-.7s1.3.2,1.8.7c.5.5.7,1,.7,1.7s-.2,1.2-.7,1.7c-.5.5-1.1.7-1.8.7s-1.3-.2-1.8-.7ZM140,28.9v16h-4v-16h4Z"/>
      <path className="l3" d="M147.7,23.5v21.4h-4v-21.4h4Z"/>
      <path className="l3" d="M166.8,28.9l-9.9,23.6h-4.3l3.5-8-6.4-15.6h4.5l4.1,11.2,4.2-11.2h4.3Z"/>
      <path className="l3" d="M168,32.5c.7-1.2,1.6-2.2,2.8-2.9s2.6-1,4.1-1,3.6.5,4.9,1.5c1.3,1,2.2,2.4,2.6,4.2h-4.4c-.2-.7-.6-1.2-1.2-1.6-.5-.4-1.2-.6-2-.6-1.2,0-2.1.4-2.7,1.3-.7.8-1,2-1,3.6s.3,2.7,1,3.5c.7.8,1.6,1.3,2.7,1.3,1.6,0,2.7-.7,3.2-2.2h4.4c-.4,1.7-1.3,3.1-2.6,4.1-1.3,1-2.9,1.5-4.9,1.5s-2.9-.3-4.1-1-2.1-1.6-2.8-2.9c-.7-1.2-1-2.7-1-4.3s.3-3.1,1-4.3Z"/>
      <path className="l3" d="M191.2,29.4c.8-.5,1.8-.7,2.9-.7v4.2h-1.1c-1.3,0-2.2.3-2.9.9-.6.6-1,1.6-1,3.1v8h-4v-16h4v2.5c.5-.8,1.2-1.5,2-2Z"/>
      <path className="l3" d="M196.5,32.5c.6-1.3,1.5-2.2,2.6-2.9,1.1-.7,2.3-1,3.7-1s2.2.2,3.1.7c.9.5,1.6,1.1,2.2,1.8v-2.3h4.1v16h-4.1v-2.3c-.5.8-1.2,1.4-2.2,1.9s-2,.7-3.2.7-2.6-.3-3.7-1c-1.1-.7-2-1.7-2.6-2.9-.6-1.3-1-2.7-1-4.3s.3-3.1,1-4.3ZM207.5,34.3c-.4-.7-.9-1.2-1.6-1.6-.7-.4-1.4-.6-2.1-.6s-1.4.2-2.1.5-1.2.9-1.5,1.6c-.4.7-.6,1.5-.6,2.5s.2,1.8.6,2.5c.4.7.9,1.3,1.6,1.7.6.4,1.3.6,2.1.6s1.5-.2,2.1-.6c.7-.4,1.2-.9,1.6-1.6.4-.7.6-1.5.6-2.5s-.2-1.8-.6-2.5Z"/>
      <path className="l3" d="M220.6,32.2v7.7c0,.5.1.9.4,1.2.3.2.7.4,1.3.4h1.9v3.4h-2.5c-3.4,0-5.1-1.7-5.1-5v-7.7h-1.9v-3.3h1.9v-4h4.1v4h3.6v3.3h-3.6Z"/>
      <path className="l3" d="M241.6,38.1h-11.7c0,1.2.5,2.1,1.2,2.7.7.7,1.6,1,2.6,1,1.5,0,2.6-.6,3.2-1.9h4.4c-.5,1.5-1.3,2.8-2.7,3.8-1.3,1-2.9,1.5-4.8,1.5s-2.9-.3-4.1-1c-1.2-.7-2.2-1.7-2.9-2.9-.7-1.3-1-2.7-1-4.3s.3-3.1,1-4.4c.7-1.3,1.6-2.2,2.8-2.9,1.2-.7,2.6-1,4.2-1s2.9.3,4.1,1c1.2.7,2.1,1.6,2.8,2.8.7,1.2,1,2.6,1,4.1s0,1.1-.1,1.6ZM237.5,35.4c0-1-.4-1.9-1.1-2.5-.7-.6-1.6-.9-2.7-.9s-1.8.3-2.5.9-1.1,1.5-1.3,2.5h7.6Z"/>
    </g><g>
      <path className="l0" d="M65.6,66.4c-19.9,0-39.6,0-59.6,0,0-19.8,0-39.6,0-59.6,19.8,0,39.5,0,59.6,0,0,19.8,0,39.5,0,59.6ZM18.3,25.3c9.7,10.1,18.8,19.6,27.4,28.7,3,0,5.3,0,7.7,0,0-2,0-3.8,0-5.5-9.6-9.9-19.2-19.8-28.6-29.4-2.3,0-4.4,0-6.5,0,0,2.5,0,4.9,0,6.2ZM56.5,18.7c0,11.8,0,24.1,0,35.3,2.5,2.7,4.5,4.9,6.6,7.1,0-16.3,0-32.7,0-49.1-2.1,2.2-4.2,4.3-6.6,6.7ZM60.7,9.4c-16.6,0-33,0-49.3,0,2.1,2.1,4.2,4.3,6.4,6.6,11.9,0,24.2,0,37,0,1.6-1.7,3.4-3.7,5.3-5.7.2-.2.3-.5.6-.9ZM11.1,63.7c16.6,0,33,0,49.4,0-2.2-2.3-4.2-4.5-6.2-6.5-12.4,0-24.7,0-36.4,0-2.4,2.3-4.5,4.3-6.8,6.5ZM8.7,11.8c0,16.6,0,33,0,49.1,2.1-2,4.2-4,6.5-6.2,0-12,0-24.3,0-36-2.3-2.4-4.4-4.5-6.5-6.8ZM46.1,19.1c0,5.8,0,11.5,0,17.3,2.3,2.2,4.8,4.6,7.2,6.9,0-7.8,0-15.9,0-24.2-2.4,0-4.6,0-7.2,0ZM18.4,54c2.8,0,5.2,0,7.8,0,0-5.2,0-10.2,0-13.9-3-3.3-5.4-5.9-7.8-8.5,0,7.5,0,14.9,0,22.5ZM42.9,19.1c-4.7,0-9.1,0-14.1,0,5,4.7,9.6,9,14.1,13.3,0-4.1,0-8.5,0-13.3ZM29.8,42.4c0,4.1,0,7.8,0,11.6,4,0,7.7,0,10.9,0-3.5-3.7-7.1-7.5-10.9-11.6Z"/>
      <path className="l1" d="M24.8,19.1c.7.7,1.4,1.4,2.1,2.2h4.1c-.8-.7-1.5-1.4-2.3-2.1h-4Z"/>
      <path className="l1" d="M42.9,19.1v2.1h3.3v-2.1h-3.3Z"/>
      <path className="l1" d="M29.8,54v-2.2h-3.5v2.2h3.5Z"/>
      <path className="l1" d="M45.6,54c-.7-.7-1.4-1.4-2.1-2.2h-4.8c.7.7,1.4,1.5,2.1,2.2h4.9Z"/>
    </g></g></g>
  </svg>
);

// ─── Password field with eye toggle ──────────────────────────────────────────
function PwField({ value, onChange, placeholder, onKeyDown, style }) {
  const [show, setShow] = useState(false);
  const EyeIcon = () => show
    ? <svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
    : <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
  return (
    <div className="pw-wrap">
      <input className="min" type={show?"text":"password"} value={value} onChange={onChange} placeholder={placeholder||"Password"} onKeyDown={onKeyDown} style={style}/>
      <button className="pw-eye" type="button" onClick={()=>setShow(p=>!p)} tabIndex={-1}><EyeIcon/></button>
    </div>
  );
}

function Avatar({ member, size = 24 }) {
  if (member.photo) return <img src={member.photo} alt={member.name} style={{width:size,height:size,borderRadius:"50%",objectFit:"cover",flexShrink:0}}/>;
  return <div style={{width:size,height:size,borderRadius:"50%",background:member.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*.38,fontWeight:700,color:"#fff",flexShrink:0}}>{member.name.slice(0,2).toUpperCase()}</div>;
}
function ModalWrap({ children, onClose }) {
  return <div className="ov" onMouseDown={e=>e.target===e.currentTarget&&onClose()}>{children}</div>;
}

// ─── Item Modal ───────────────────────────────────────────────────────────────
function ItemModal({ item, members, prefill, onSave, onDelete, onClose }) {
  const [text,setText]   = useState(item?.text??"");
  const [pts,setPts]     = useState(String(item?.points??5));
  const [cat,setCat]     = useState(item?.category??"chores");
  const [who,setWho]     = useState(item?.assignedTo??prefill?.assignedTo??[]);
  const [rep,setRep]     = useState(item?.repeat??"none");
  const [sd,setSd]       = useState(item?.startDate??item?.date??TODAY);
  const [st,setSt]       = useState(item?.time??"");
  const [et,setEt]       = useState(()=>{ if(!item?.time||!item?.duration) return ""; const sm=timeToMinutes(item.time); return sm<0?"":minutesToTime12(sm+(item.duration||30)); });
  const [note,setNote]   = useState(item?.note??"");
  const toggleWho=id=>setWho(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  const calcDur=()=>{ const sm=timeToMinutes(st),em=timeToMinutes(et); return (sm<0||em<0||em<=sm)?30:em-sm; };
  const save=()=>{ if(!text.trim()) return; const dur=calcDur(); const base={text:text.trim(),points:Math.max(0,parseInt(pts)||0),category:cat,assignedTo:who,repeat:rep,time:st,duration:dur,note:note.trim()||undefined}; onSave(rep==="none"?{...base,date:sd}:{...base,startDate:sd}); };
  return (<ModalWrap onClose={onClose}><div className="modal"><div className="mhandle"/><div className="mtitle">{item?"Edit item":"Add item"}</div>
    <div className="mrow"><div className="mlbl">Description</div><input className="min" value={text} onChange={e=>setText(e.target.value)} placeholder="What needs doing?" autoFocus onKeyDown={e=>e.key==="Enter"&&save()}/></div>
    <div className="mgrid2">
      <div className="mrow"><div className="mlbl">Points</div><input className="min" type="number" min="0" value={pts} onChange={e=>setPts(e.target.value)}/></div>
      <div className="mrow"><div className="mlbl">Category</div><select className="min" value={cat} onChange={e=>setCat(e.target.value)}><option value="chores">Chores</option><option value="groceries">Groceries</option><option value="todos">To-Dos</option></select></div>
    </div>
    <div className="mgrid3">
      <div className="mrow"><div className="mlbl">Start time</div><select className="min" value={st} onChange={e=>setSt(e.target.value)}><option value="">No time</option>{TIME_OPTIONS.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
      <div className="mrow"><div className="mlbl">End time</div><select className="min" value={et} onChange={e=>setEt(e.target.value)}><option value="">—</option>{TIME_OPTIONS.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
      <div className="mrow"><div className="mlbl">Repeat</div><select className="min" value={rep} onChange={e=>setRep(e.target.value)}><option value="none">Once</option><option value="daily">Daily</option><option value="weekly-dow">Weekly</option><option value="monthly">Monthly</option></select></div>
    </div>
    <div className="mrow"><div className="mlbl">{rep==="none"?"Date":"Starts"}</div><input className="min" type="date" value={sd} onChange={e=>setSd(e.target.value)}/></div>
    <div className="mrow"><div className="mlbl">Assign to</div><div className="ag"><button className={`ac ${who.length===0?"on":""}`} onClick={()=>setWho([])}>Anyone</button>{members.map(m=><button key={m.id} className={`ac ${who.includes(m.id)?"on":""}`} onClick={()=>toggleWho(m.id)}><Avatar member={m} size={13}/>{m.name}</button>)}</div></div>
    <div className="mrow"><div className="mlbl">Note</div><input className="min" value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional note…"/></div>
    <div className="mact">{item&&<button className="mbtn-del" onClick={onDelete}>Delete</button>}<button className="mbtn-ghost" onClick={onClose}>Cancel</button><button className="mbtn-pri" onClick={save}>Save</button></div>
  </div></ModalWrap>);
}

// ─── Event Modal ──────────────────────────────────────────────────────────────
function EventModal({ event, members, onSave, onDelete, onClose }) {
  const [title,setTitle] = useState(event?.title??"");
  const [date,setDate]   = useState(event?.date??TODAY);
  const [sd,setSd]       = useState(event?.startDate??event?.date??TODAY);
  const [st,setSt]       = useState(event?.time??"");
  const [et,setEt]       = useState(()=>{ if(!event?.time||!event?.duration) return ""; const sm=timeToMinutes(event.time); return sm<0?"":minutesToTime12(sm+(event.duration||60)); });
  const [who,setWho]     = useState(event?.memberIds??[]);
  const [rep,setRep]     = useState(event?.repeat??"none");
  const [type,setType]   = useState(event?.type??"family");
  const toggleWho=id=>setWho(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  const colorMap={school:SCHOOL_COLOR,activity:CKY_COLOR,family:SHARED_COLOR};
  const calcDur=()=>{ const sm=timeToMinutes(st),em=timeToMinutes(et); return (sm<0||em<0||em<=sm)?60:em-sm; };
  const save=()=>{ if(!title.trim()) return; const dur=calcDur(); const singleMember=who.length===1?members.find(m=>m.id===who[0]):null; const color=singleMember?singleMember.color:colorMap[type]??SHARED_COLOR; const base={title:title.trim(),time:st,duration:dur,memberIds:who,repeat:rep,type,color}; onSave(rep==="none"?{...base,date}:{...base,startDate:sd,date:sd}); };
  return (<ModalWrap onClose={onClose}><div className="modal"><div className="mhandle"/><div className="mtitle">{event?"Edit event":"Add event"}</div>
    <div className="mrow"><div className="mlbl">Title</div><input className="min" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Event name" autoFocus onKeyDown={e=>e.key==="Enter"&&save()}/></div>
    <div className="mrow"><div className="mlbl">{rep==="none"?"Date":"Starts"}</div><input className="min" type="date" value={rep==="none"?date:sd} onChange={e=>rep==="none"?setDate(e.target.value):setSd(e.target.value)}/></div>
    <div className="mgrid3">
      <div className="mrow"><div className="mlbl">Start time</div><select className="min" value={st} onChange={e=>setSt(e.target.value)}><option value="">No time</option>{TIME_OPTIONS.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
      <div className="mrow"><div className="mlbl">End time</div><select className="min" value={et} onChange={e=>setEt(e.target.value)}><option value="">—</option>{TIME_OPTIONS.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
      <div className="mrow"><div className="mlbl">Repeat</div><select className="min" value={rep} onChange={e=>setRep(e.target.value)}><option value="none">Once</option><option value="daily">Daily</option><option value="weekly-dow">Weekly</option><option value="monthly">Monthly</option></select></div>
    </div>
    <div className="mgrid2"><div className="mrow"><div className="mlbl">Type</div><select className="min" value={type} onChange={e=>setType(e.target.value)}><option value="family">Family</option><option value="school">School</option><option value="activity">Activity</option></select></div></div>
    <div className="mrow"><div className="mlbl">Who's involved</div><div className="ag"><button className={`ac ${who.length===0?"on":""}`} onClick={()=>setWho([])}>Everyone</button>{members.map(m=><button key={m.id} className={`ac ${who.includes(m.id)?"on":""}`} onClick={()=>toggleWho(m.id)}><Avatar member={m} size={13}/>{m.name}</button>)}</div></div>
    <div className="mact">{event&&<button className="mbtn-del" onClick={onDelete}>Delete</button>}<button className="mbtn-ghost" onClick={onClose}>Cancel</button><button className="mbtn-pri" onClick={save}>Save</button></div>
  </div></ModalWrap>);
}

// ─── Member Modal ─────────────────────────────────────────────────────────────
function MemberModal({ member, onSave, onDelete, onClose }) {
  const [name,setName]   = useState(member?.name??"");
  const [color,setColor] = useState(member?.color??"#3A6ACC");
  const [photo,setPhoto] = useState(member?.photo??null);
  const [email,setEmail] = useState(member?.email??"");
  const fileRef = useRef();
  const COLORS=["#E07830","#3A9A5A","#2A9090","#CC3A3A","#3A6ACC","#9A4AAA","#AA7030","#3A80AA","#AA3A6A","#6A8A3A"];
  const handlePhoto=e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>setPhoto(ev.target.result); r.readAsDataURL(f); };
  const save=()=>{ if(!name.trim()) return; onSave({name:name.trim(),color,photo,email,phone:""}); };
  return (<ModalWrap onClose={onClose}><div className="modal"><div className="mhandle"/><div className="mtitle">{member?"Edit member":"Add member"}</div>
    <div className="mrow"><div className="mlbl">Photo</div>
      <div style={{display:"flex",alignItems:"center",gap:11}}>
        {photo?<img src={photo} style={{width:52,height:52,borderRadius:"50%",objectFit:"cover",border:"2px solid var(--bdr)"}}/>:<div style={{width:52,height:52,borderRadius:"50%",background:color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:700,color:"#fff"}}>{name.slice(0,2).toUpperCase()||"?"}</div>}
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          <button className="photo-btn" onClick={()=>fileRef.current.click()}>Upload photo</button>
          {photo&&<button className="photo-btn" onClick={()=>setPhoto(null)}>Remove</button>}
          <input ref={fileRef} type="file" accept="image/*" className="photo-input" onChange={handlePhoto}/>
        </div>
      </div></div>
    <div className="mrow"><div className="mlbl">Name</div><input className="min" value={name} onChange={e=>setName(e.target.value)} placeholder="Name" autoFocus/></div>
    <div className="mrow"><div className="mlbl">Color</div><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{COLORS.map(c=><div key={c} onClick={()=>setColor(c)} style={{width:26,height:26,borderRadius:"50%",background:c,cursor:"pointer",border:`3px solid ${color===c?"var(--ink)":"transparent"}`,transition:"border .15s"}}/>)}</div></div>
    <div className="mrow"><div className="mlbl">Email (notifications)</div><input className="min" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="email@example.com"/></div>
    <div className="mact">{member&&<button className="mbtn-del" onClick={onDelete}>Remove</button>}<button className="mbtn-ghost" onClick={onClose}>Cancel</button><button className="mbtn-pri" onClick={save}>Save</button></div>
  </div></ModalWrap>);
}

function RewardModal({ reward, onSave, onDelete, onClose }) {
  const [title,setTitle]=useState(reward?.title??""); const [pts,setPts]=useState(String(reward?.points??10)); const [icon,setIcon]=useState(reward?.icon??"gift");
  const ICONS=["screen","dinner","late","movie","skip","cash","gift"];
  const LABELS={"screen":"Screen time","dinner":"Pick dinner","late":"Stay up late","movie":"Movie pick","skip":"Skip a chore","cash":"Cash out","gift":"Gift"};
  const save=()=>{if(!title.trim())return;onSave({title:title.trim(),points:Math.max(1,parseInt(pts)||1),icon});};
  return (<ModalWrap onClose={onClose}><div className="modal"><div className="mhandle"/><div className="mtitle">{reward?"Edit reward":"Add reward"}</div>
    <div className="mrow"><div className="mlbl">Title</div><input className="min" value={title} onChange={e=>setTitle(e.target.value)} autoFocus/></div>
    <div className="mrow"><div className="mlbl">Points cost</div><input className="min" type="number" min="1" value={pts} onChange={e=>setPts(e.target.value)} style={{width:90}}/></div>
    <div className="mrow"><div className="mlbl">Icon</div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{ICONS.map(ic=><button key={ic} onClick={()=>setIcon(ic)} style={{width:44,height:44,border:`1.5px solid ${icon===ic?"var(--sky)":"var(--bdr)"}`,borderRadius:9,background:icon===ic?"var(--sky-lt)":"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:4}}>
      <div style={{width:18,height:18,color:icon===ic?"var(--sky)":"var(--muted)",stroke:"currentColor"}}>{REWARD_ICONS[ic]||REWARD_ICONS.gift}</div>
      <div style={{fontSize:8,color:icon===ic?"var(--sky)":"var(--muted)"}}>{LABELS[ic]}</div>
    </button>)}</div></div>
    <div className="mact">{reward&&<button className="mbtn-del" onClick={onDelete}>Delete</button>}<button className="mbtn-ghost" onClick={onClose}>Cancel</button><button className="mbtn-pri" onClick={save}>Save</button></div>
  </div></ModalWrap>);
}

function RedeemModal({ reward, members, earnedInPeriod, spentPoints, onSubmit, onClose }) {
  const [who,setWho]=useState(null);
  const avail=who?earnedInPeriod(who)-(spentPoints[who]||0):0;
  const canAfford=who?avail>=reward.points:false;
  return (<ModalWrap onClose={onClose}><div className="modal"><div className="mhandle"/><div className="mtitle">Redeem: {reward.title}</div>
    <div style={{fontSize:13,color:"var(--muted)"}}>Costs {reward.points} pts. Who is redeeming?</div>
    <div className="ag">{members.map(m=>{ const a=earnedInPeriod(m.id)-(spentPoints[m.id]||0); return (<button key={m.id} className={`ac ${who===m.id?"on":""}`} onClick={()=>setWho(m.id)}><Avatar member={m} size={13}/>{m.name} <span style={{fontSize:10,opacity:.7}}>({a}pt)</span></button>); })}</div>
    {who&&!canAfford&&<div style={{fontSize:12,color:"#CC3A3A"}}>Not enough points — needs {reward.points}, has {avail}</div>}
    <div className="mact"><button className="mbtn-ghost" onClick={onClose}>Cancel</button><button className="mbtn-pri" disabled={!who||!canAfford} onClick={()=>who&&canAfford&&onSubmit(who)} style={{opacity:(who&&canAfford)?1:.5}}>Request</button></div>
  </div></ModalWrap>);
}

function ConfirmModal({ title, message, onConfirm, onClose }) {
  return (<ModalWrap onClose={onClose}><div className="modal"><div className="mhandle"/><div className="mtitle">{title}</div>
    <div style={{fontSize:13,color:"var(--ink2)",lineHeight:1.5}}>{message}</div>
    <div className="mact"><button className="mbtn-ghost" onClick={onClose}>Cancel</button><button className="mbtn-del" onClick={onConfirm}>Confirm</button></div>
  </div></ModalWrap>);
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const Icons = {
  home: <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  list: <svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  star: <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  gear: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  cal:  <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  plus: <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
};

// ─── Login Gate (standalone — no hooks ordering issues) ───────────────────────
function LiveClock() {
  const [t,setT]=useState(()=>new Date());
  useEffect(()=>{const id=setInterval(()=>setT(new Date()),1000);return()=>clearInterval(id);},[]);
  const h=t.getHours(),m=t.getMinutes(),ampm=h>=12?"PM":"AM";
  const hh=h>12?h-12:h===0?12:h;
  const ds=t.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",lineHeight:1.25}}>
      <span style={{fontSize:14,fontWeight:600,color:"var(--ink)",letterSpacing:-.2}}>{ds}</span>
      <span style={{fontSize:11,color:"var(--muted)"}}>{hh}:{String(m).padStart(2,"0")} {ampm}</span>
    </div>
  );
}

function LoginGate({ onLogin }) {
  const [email,setEmail] = useState("");
  const [pw,setPw]       = useState("");
  const [err,setErr]     = useState("");
  const [loading,setLoading] = useState(false);

  const submit = async () => {
    if (!email || !pw) return;
    setLoading(true); setErr("");
    try {
      await apiLogin(email, pw);
      onLogin();
    } catch(e) { setErr(e.message); setLoading(false); }
  };

  return (
    <div style={{minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"var(--bg)",padding:24}}>
      <div style={{marginBottom:28}}><LogoSVG height={44}/></div>
      <div style={{width:"100%",maxWidth:380,background:"var(--surf)",borderRadius:18,border:"1.5px solid var(--bdr)",padding:"32px 28px",boxShadow:"0 8px 32px rgba(26,42,56,.1)"}}>
        <div style={{fontSize:22,fontWeight:500,marginBottom:4,color:"var(--ink)"}}>Welcome back</div>
        <div style={{fontSize:14,color:"var(--muted)",marginBottom:24}}>Sign in to your family hub</div>
        {err&&<div style={{padding:"9px 12px",background:"#FDEAEA",border:"1.5px solid #E8B8B8",borderRadius:8,fontSize:13,color:"#CC3A3A",marginBottom:14}}>{err}</div>}
        <div className="mrow" style={{marginBottom:14}}>
          <div className="mlbl">Email</div>
          <input className="min" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="your@email.com" onKeyDown={e=>e.key==="Enter"&&submit()}/>
        </div>
        <div className="mrow" style={{marginBottom:22}}>
          <div className="mlbl">Password</div>
          <PwField value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()}/>
        </div>
        <button onClick={submit} disabled={loading}
          style={{width:"100%",padding:13,borderRadius:100,border:"none",background:"#3A6A88",color:"#fff",fontFamily:"DM Sans,sans-serif",fontSize:14,fontWeight:500,cursor:loading?"not-allowed":"pointer",opacity:loading?.6:1,transition:"background .2s"}}>
          {loading?"Signing in…":"Sign in →"}
        </button>
        <div style={{textAlign:"center",marginTop:16,fontSize:13,color:"var(--muted)"}}>
          No account? <a href="/register.html" style={{color:"#3A6A88",textDecoration:"none",fontWeight:500}}>Start free trial</a>
        </div>
      </div>
    </div>
  );
}

function ExpiredGate({ onLogout }) {
  return (
    <div style={{minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"var(--bg)",padding:24}}>
      <div style={{marginBottom:28}}><LogoSVG height={44}/></div>
      <div style={{width:"100%",maxWidth:400,background:"var(--surf)",borderRadius:18,border:"2px solid #E8B8B8",padding:32,textAlign:"center"}}>
        <div style={{fontSize:36,marginBottom:16}}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#CC3A3A" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div style={{fontSize:20,fontWeight:500,marginBottom:8,color:"var(--ink)"}}>Your trial has ended</div>
        <div style={{fontSize:14,color:"var(--muted)",lineHeight:1.65,marginBottom:24}}>Subscribe to get back to full access. Your family data is safe and waiting.</div>
        <a href="/subscription.html" style={{display:"block",padding:13,borderRadius:100,background:"#3A6A88",color:"#fff",textDecoration:"none",fontFamily:"DM Sans,sans-serif",fontSize:14,fontWeight:500,marginBottom:10}}>Subscribe to FamilyCrate</a>
        <button onClick={onLogout} style={{width:"100%",padding:11,borderRadius:100,border:"1.5px solid var(--bdr)",background:"none",fontFamily:"DM Sans,sans-serif",fontSize:13,cursor:"pointer",color:"var(--muted)"}}>Sign out</button>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"var(--bg)"}}>
      <LogoSVG height={44}/>
      <div style={{marginTop:16,fontSize:13,color:"var(--muted)"}}>Loading your family…</div>
    </div>
  );
}

// ─── App Shell — wraps auth check around the main app ─────────────────────────
export default function AppShell() {
  const [authState, setAuthState] = useState("checking");
  const [appData, setAppData]     = useState(null);

  useEffect(() => {
    const token = localStorage.getItem("fc_token");
    if (!token) { setAuthState("login"); return; }
    apiMe()
      .then(({ family }) => {
        const isOwner = family?.owner_email === "cliffhilton@gmail.com";
        const expired  = !isOwner && family?.subscription_status === "trialing" && family?.trial_ends_at && new Date(family.trial_ends_at) < new Date();
        const cancelled = !isOwner && family?.subscription_status === "cancelled";
        if (expired || cancelled) { setAuthState("expired"); return; }
        // Load family data
        return apiGetFamily().then(data => { setAppData(data); setAuthState("app"); });
      })
      .catch(() => {
        // No valid token — show login but let app load with localStorage data
        setAuthState("app");
      });
  }, []);

  const handleLogin = () => {
    apiMe()
      .then(({ family }) => {
        const isOwner = family?.owner_email === "cliffhilton@gmail.com";
        const expired = !isOwner && family?.subscription_status === "trialing" && family?.trial_ends_at && new Date(family.trial_ends_at) < new Date();
        if ((!isOwner && expired) || (!isOwner && family?.subscription_status === "cancelled")) { setAuthState("expired"); return; }
        return apiGetFamily().then(data => { setAppData(data); setAuthState("app"); });
      })
      .catch(() => setAuthState("app"));
  };

  const handleLogout = () => { apiLogout(); setAppData(null); setAuthState("login"); };

  if (authState === "checking") return <LoadingScreen/>;
  if (authState === "login")    return <LoginGate onLogin={handleLogin}/>;
  if (authState === "expired")  return <ExpiredGate onLogout={handleLogout}/>;

  return <FamilyCrate apiData={appData} onLogout={handleLogout}/>;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function FamilyCrate({ apiData, onLogout }) {
  // Favicon + title
  useEffect(() => {
    const el = document.querySelector("link[rel='icon']"); if (el) el.remove();
    const l = document.createElement("link"); l.rel = "icon"; l.type = "image/svg+xml";
    l.href = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`;
    document.head.appendChild(l);
    document.title = "FamilyCrate";
  }, []);

  function load(k, fb) { try { const v=localStorage.getItem(k); return v?JSON.parse(v):fb; } catch { return fb; } }
  function save(k, v)  { try { localStorage.setItem(k,JSON.stringify(v)); } catch {} }

  // Initialize from API data if available, else localStorage
  const [members,setMR]      = useState(()=>apiData?.members?.length ? apiData.members : load("fc_members",INIT_MEMBERS));
  const [items,setIR]        = useState(()=>apiData?.items?.length   ? apiData.items   : load("fc_items",  INIT_ITEMS));
  const [events,setER]       = useState(()=>apiData?.events?.length  ? apiData.events  : load("fc_events", INIT_EVENTS));
  const [rewards,setRwR]     = useState(()=>apiData?.rewards?.length ? apiData.rewards : load("fc_rewards",INIT_REWARDS));
  const [doneLog,setDLR]     = useState(()=>apiData?.doneLog         ? apiData.doneLog : load("fc_donelog",{}));
  const [redeemReqs,setRRR]  = useState(()=>apiData?.redeemReqs      ? apiData.redeemReqs : load("fc_reqs",[]));
  const [spentPoints,setSPR] = useState(()=>apiData?.spentPoints     ? apiData.spentPoints : load("fc_spent",{}));
  const [categories,setCatsR] = useState(()=>apiData?.categories?.length ? apiData.categories : load("fc_cats",INIT_CATEGORIES));
  const [rate,setRateR]      = useState(()=>apiData?.rate            ? apiData.rate    : load("fc_rate",0.25));
  const [periodStart,setPSR] = useState(()=>apiData?.periodStart     ? apiData.periodStart : load("fc_ps",PERIOD_START));
  const [periodDays,setPDR]  = useState(()=>apiData?.periodDays      ? apiData.periodDays  : load("fc_pd",14));

  const setMembers     = v=>{const n=typeof v==="function"?v(members):v;    save("fc_members",n);  setMR(n);};
  const setItems       = v=>{const n=typeof v==="function"?v(items):v;      save("fc_items",n);    setIR(n);};
  const setEvents      = v=>{const n=typeof v==="function"?v(events):v;     save("fc_events",n);   setER(n);};
  const setRewards     = v=>{const n=typeof v==="function"?v(rewards):v;    save("fc_rewards",n);  setRwR(n);};
  const setDoneLog     = v=>{const n=typeof v==="function"?v(doneLog):v;    save("fc_donelog",n);  setDLR(n);};
  const setRedeemReqs  = v=>{const n=typeof v==="function"?v(redeemReqs):v; save("fc_reqs",n);     setRRR(n);};
  const setSpentPoints = v=>{const n=typeof v==="function"?v(spentPoints):v;save("fc_spent",n);    setSPR(n);};
  const setRate        = v=>{const n=typeof v==="function"?v(rate):v;       save("fc_rate",n);     setRateR(n);};
  const setCategories  = v=>{const n=typeof v==="function"?v(categories):v; save("fc_cats",n); setCatsR(n); apiUpdateSettings({categories:n}).catch(console.error);};
  const setPeriodStart = v=>{const n=typeof v==="function"?v(periodStart):v;save("fc_ps",n);       setPSR(n);};
  const setPeriodDays  = v=>{const n=typeof v==="function"?v(periodDays):v; save("fc_pd",n);       setPDR(n);};

  const [view,setView]           = useState("home");
  const [dayView,setDayView]     = useState("day");
  const [ptsTab,setPtsTab]       = useState("lb");
  const [selDate,setSelDate]     = useState(TODAY);
  const [calMo,setCalMo]         = useState(new Date(TODAY+"T12:00:00").setDate(1));
  const [filterMids,setFilterMids] = useState(new Set());
  const [showWeekends,setShowWeekends] = useState(true);
  const [calOpen,setCalOpen]     = useState(false);
  const [hamOpen,setHamOpen]     = useState(false);
  const [addOpen,setAddOpen]     = useState(false);
  const [listTab,setListTab]     = useState(()=>{ const cats=apiData?.categories?.length?apiData.categories:INIT_CATEGORIES; return cats[0]?.id||"chores"; });
  const [listFmid,setListFmid]   = useState(null);
  const [iModal,setIModal]       = useState(null);
  const [eModal,setEModal]       = useState(null);
  const [mModal,setMModal]       = useState(null);
  const [rwModal,setRwModal]     = useState(null);
  const [rdModal,setRdModal]     = useState(null);
  const [confirmModal,setConfirmModal] = useState(null);
  const [aText,setAText]         = useState("");
  const [aPts,setAPts]           = useState("5");
  const [nowMins,setNowMins]     = useState(()=>{const n=new Date();return n.getHours()*60+n.getMinutes();});
  const gridScrollRef  = useRef(null);
  const colHdrsRef     = useRef(null);
  const dragRef        = useRef(null);
  const [dragging,setDragging]   = useState(null);
  // touchStartPos ref declared near onTouchStart
  const isMobile       = typeof window!=="undefined" && window.innerWidth<=660;

  useEffect(()=>{ const t=setInterval(()=>{const n=new Date();setNowMins(n.getHours()*60+n.getMinutes());},60000); return()=>clearInterval(t); },[]);
  useEffect(()=>{ if(!gridScrollRef.current) return; const top=minutesToTop(Math.max(nowMins-60,DAY_START))-20; gridScrollRef.current.scrollTop=Math.max(0,top); },[selDate,dayView]);
  useEffect(()=>{ const g=gridScrollRef.current,h=colHdrsRef.current; if(!g||!h) return; const fn=()=>{h.scrollLeft=g.scrollLeft;}; g.addEventListener("scroll",fn,{passive:true}); return()=>g.removeEventListener("scroll",fn); },[dayView,selDate]);
  useEffect(()=>{ const el=gridScrollRef.current; if(!el) return; const fn=e=>{if(Math.abs(e.deltaX)>Math.abs(e.deltaY)&&Math.abs(e.deltaX)>30){e.preventDefault();if(e.deltaX>0) setSelDate(d=>dayView==="day"?addDays(d,1):addDays(d,7));else setSelDate(d=>dayView==="day"?addDays(d,-1):addDays(d,-7));}}; el.addEventListener("wheel",fn,{passive:false}); return()=>el.removeEventListener("wheel",fn); },[dayView]);

  // Calendar
  const calDate=new Date(calMo); const yr=calDate.getFullYear(),mo=calDate.getMonth();
  const fd=new Date(yr,mo,1).getDay(),dim=new Date(yr,mo+1,0).getDate(),pmd=new Date(yr,mo,0).getDate();
  const cells=[]; for(let i=fd-1;i>=0;i--) cells.push({d:pmd-i,cur:false}); for(let d=1;d<=dim;d++) cells.push({d,cur:true}); while(cells.length%7!==0) cells.push({d:cells.length-dim-fd+1,cur:false});
  const toCellDate=c=>c.cur?`${yr}-${String(mo+1).padStart(2,"0")}-${String(c.d).padStart(2,"0")}`:null;

  const eventsOnDate=useCallback(ds=>{const seen=new Set();return events.filter(ev=>{if(!eventAppearsOn(ev,ds))return false;if(seen.has(ev.id))return false;seen.add(ev.id);return true;});},[events]);
  const itemsForMemberOnDate=useCallback((mid,ds)=>items.filter(it=>(it.assignedTo.length===0||it.assignedTo.includes(mid))&&appearsOnDate(it,ds)),[items]);
  const isDone=(itemId,memberId,ds)=>!!doneLog[doneKey(itemId,memberId,ds)];
  const toggleDone=(itemId,memberId,ds)=>{
    const k=doneKey(itemId,memberId,ds);
    const newVal=!doneLog[k];
    setDoneLog(p=>({...p,[k]:newVal}));
    apiToggleDone(k,newVal).catch(console.error);
  };

  const earnedInPeriod=useCallback(mid=>{
    let total=0;
    Object.entries(doneLog).forEach(([k,done])=>{
      if(!done) return; const parts=k.split("__"); if(parts.length<3) return;
      const[idStr,midStr,ds]=parts; if(String(mid)!==midStr||ds<periodStart||ds>TODAY) return;
      const item=items.find(i=>String(i.id)===idStr); if(item&&item.points>0) total+=item.points;
    }); return total;
  },[doneLog,items,periodStart]);

  const netPoints=mid=>earnedInPeriod(mid)-(spentPoints[mid]||0);
  const dFmt=n=>n%1===0?`$${n}`:`$${n.toFixed(2)}`;

  const visibleMembers=useMemo(()=>filterMids.size===0?members:members.filter(m=>filterMids.has(m.id)),[members,filterMids]);
  const toggleFilter=mid=>setFilterMids(p=>{const n=new Set(p);n.has(mid)?n.delete(mid):n.add(mid);return n;});

  const weekStart=startOfWeek(selDate);
  const weekDates=useMemo(()=>{
    const all=Array.from({length:7},(_,i)=>addDays(weekStart,i));
    return showWeekends?all:all.filter(ds=>{const dow=getDow(ds);return dow>0&&dow<6;});
  },[weekStart,showWeekends]);

  // CRUD
  const saveMember=async(id,p)=>{
    if(id){
      setMembers(m=>m.map(v=>v.id===id?{...v,...p}:v));
      apiUpdateMember(id,p).catch(console.error);
    } else {
      try {
        const res=await apiAddMember(p);
        setMembers(m=>[...m,{id:res.id||uid(),color:"#3A6ACC",photo:null,email:"",phone:"",...p,...(res.id?{id:res.id}:{})}]);
      } catch { setMembers(m=>[...m,{id:uid(),color:"#3A6ACC",photo:null,email:"",phone:"",...p}]); }
    }
  };
  const delMember=id=>{
    setMembers(m=>m.filter(v=>v.id!==id));
    setItems(i=>i.map(v=>({...v,assignedTo:v.assignedTo.filter(x=>x!==id)})));
    setFilterMids(p=>{const n=new Set(p);n.delete(id);return n;});
    apiDeleteMember(id).catch(console.error);
  };
  const saveItem=async(id,p)=>{
    if(id){
      setItems(i=>i.map(v=>v.id===id?{...v,...p}:v));
      apiUpdateItem(id,p).catch(console.error);
    } else {
      try {
        const res=await apiAddItem(p);
        setItems(i=>[...i,{id:res.id||uid(),...p,...(res.id?{id:res.id}:{})}]);
      } catch { setItems(i=>[...i,{id:uid(),...p}]); }
    }
  };
  const delItem=id=>{
    setItems(i=>i.filter(v=>v.id!==id));
    apiDeleteItem(id).catch(console.error);
  };
  const addQuick=async()=>{
    if(!aText.trim()) return;
    const p={text:aText.trim(),points:Math.max(0,parseInt(aPts)||0),category:listTab,assignedTo:[],repeat:"none",date:TODAY,time:"",duration:30};
    setAText("");setAPts("5");
    try {
      const res=await apiAddItem(p);
      setItems(i=>[...i,{id:res.id||uid(),...p,...(res.id?{id:res.id}:{})}]);
    } catch { setItems(i=>[...i,{id:uid(),...p}]); }
  };
  const saveEvent=async(id,p)=>{
    if(id){
      setEvents(e=>e.map(v=>v.id===id?{...v,...p}:v));
      apiUpdateEvent(id,p).catch(console.error);
    } else {
      try {
        const res=await apiAddEvent(p);
        setEvents(e=>[...e,{id:res.id||uid(),...p,...(res.id?{id:res.id}:{})}]);
      } catch { setEvents(e=>[...e,{id:uid(),...p}]); }
    }
  };
  const delEvent=id=>{
    setEvents(e=>e.filter(v=>v.id!==id));
    apiDeleteEvent(id).catch(console.error);
  };
  const saveReward=async(id,p)=>{
    if(id){
      setRewards(r=>r.map(v=>v.id===id?{...v,...p}:v));
      apiUpdateReward(id,p).catch(console.error);
    } else {
      try {
        const res=await apiAddReward(p);
        setRewards(r=>[...r,{id:res.id||uid(),...p,...(res.id?{id:res.id}:{})}]);
      } catch { setRewards(r=>[...r,{id:uid(),...p}]); }
    }
  };
  const delReward=id=>{
    setRewards(r=>r.filter(v=>v.id!==id));
    apiDeleteReward(id).catch(console.error);
  };
  const submitRedeem=async(rId,mId)=>{
    const r=rewards.find(x=>x.id===rId); if(!r) return;
    try {
      const res=await apiRedeem({rewardId:rId,memberId:mId});
      setRedeemReqs(p=>[...p,{id:res.id||uid(),rewardId:rId,memberId:mId,status:"pending",pts:r.points,ts:Date.now()}]);
    } catch { setRedeemReqs(p=>[...p,{id:uid(),rewardId:rId,memberId:mId,status:"pending",pts:r.points,ts:Date.now()}]); }
  };
  const approveReq=id=>{
    setRedeemReqs(p=>p.map(r=>{if(r.id!==id)return r;setSpentPoints(sp=>({...sp,[r.memberId]:(sp[r.memberId]||0)+(r.pts||0)}));return{...r,status:"approved"};}));
    apiApproveRedeem(id).catch(console.error);
  };
  const declineReq=id=>{
    setRedeemReqs(p=>p.map(r=>r.id===id?{...r,status:"declined"}:r));
    apiDeclineRedeem(id).catch(console.error);
  };
  const resetPeriod=()=>{
    const ns=addDays(TODAY,-periodDays),cleaned={};
    Object.entries(doneLog).forEach(([k,v])=>{const ds=k.split("__")[2];if(ds>=ns)cleaned[k]=v;});
    setDoneLog(cleaned);setPeriodStart(ns);setSpentPoints({});setConfirmModal(null);
    apiUpdateSettings({periodStart:ns,periodDays,rate}).catch(console.error);
  };

  // Touch swipe
  const touchStartPos=useRef(null);
  const onTouchStart=e=>{touchStartPos.current={x:e.touches[0].clientX,y:e.touches[0].clientY};};
  const onTouchEnd=e=>{
    if(!touchStartPos.current)return;
    const dx=e.changedTouches[0].clientX-touchStartPos.current.x;
    const dy=e.changedTouches[0].clientY-touchStartPos.current.y;
    if(Math.abs(dx)>100&&Math.abs(dx)>Math.abs(dy)*2){
      if(dx<0)setSelDate(d=>dayView==="day"?addDays(d,1):addDays(d,7));
      else setSelDate(d=>dayView==="day"?addDays(d,-1):addDays(d,-7));
    }
    touchStartPos.current=null;
  };

  // Drag
  const onMouseDown=(e,block,mid)=>{if(block.kind!=="item")return;e.preventDefault();dragRef.current={blockId:block.id,itemId:block.itemId,memberId:mid,startY:e.clientY,origTop:block.top};setDragging({blockId:block.id,top:block.top,height:block.height,color:block.color,title:block.title});};
  useEffect(()=>{
    const onMove=e=>{if(!dragRef.current||!dragging)return;const dy=e.clientY-dragRef.current.startY;setDragging(d=>d?{...d,top:dragRef.current.origTop+dy}:null);};
    const onUp=e=>{if(!dragRef.current||!dragging)return;const dy=e.clientY-dragRef.current.startY;const newTop=dragRef.current.origTop+dy;const newMins=Math.round((newTop/MIN_PX+DAY_START)/15)*15;const clampedMins=Math.max(DAY_START,Math.min(DAY_END-30,newMins));saveItem(dragRef.current.itemId,{time:minutesToTime12(clampedMins)});dragRef.current=null;setDragging(null);};
    window.addEventListener("mousemove",onMove);window.addEventListener("mouseup",onUp);
    return()=>{window.removeEventListener("mousemove",onMove);window.removeEventListener("mouseup",onUp);};
  },[dragging]);

  function buildBlocks(mid,ds){
    const colEvs=eventsOnDate(ds).filter(ev=>ev.memberIds.includes(mid)||ev.memberIds.length===0);
    const colItems=itemsForMemberOnDate(mid,ds);
    const blocks=[];
    colEvs.forEach(ev=>{const sm=timeToMinutes(ev.time);const dur=ev.duration||60;if(sm<DAY_START||sm>=DAY_END)return;blocks.push({id:`ev-${ev.id}`,evId:ev.id,kind:"event",top:minutesToTop(sm),height:durationToPx(dur),startMins:sm,dur,title:ev.title,time:ev.time,color:ev.color||SHARED_COLOR,type:ev.type});});
    colItems.forEach(item=>{if(!item.time)return;const sm=timeToMinutes(item.time);const dur=item.duration||30;if(sm<DAY_START||sm>=DAY_END)return;blocks.push({id:`it-${item.id}`,itemId:item.id,kind:"item",top:minutesToTop(sm),height:durationToPx(dur),startMins:sm,dur,title:item.text,time:item.time,note:item.note,points:item.points,color:members.find(m=>m.id===mid)?.color||"#8A8A8A",done:isDone(item.id,mid,ds),memberId:mid});});
    return layoutBlocks(blocks);
  }

  const totalGridHeight=(DAY_END-DAY_START)*MIN_PX;
  const hours=[]; for(let h=DAY_START;h<=DAY_END;h+=60) hours.push(h);

  const renderCol=(m,ds)=>{
    const blocks=buildBlocks(m.id,ds);
    return (
      <div key={`${m.id}-${ds}`} className="pcol" style={{height:totalGridHeight,position:"relative"}}>
        {blocks.map(block=>{
          const n=Math.min(block.totalCols,3),colW=1/n,leftPct=block.col*colW*100,widthPct=colW*100;
          const isDraggingThis=dragging?.blockId===block.id;
          return (
            <div key={block.id} className="tblock"
              style={{top:block.top,height:block.height,left:`calc(${leftPct}% + 2px)`,width:`calc(${widthPct}% - 4px)`,minWidth:20,background:`${block.color}28`,borderLeftColor:block.color,opacity:isDraggingThis?.4:1,cursor:block.kind==="item"?"grab":"pointer",zIndex:block.col+1}}
              onMouseDown={block.kind==="item"?e=>onMouseDown(e,block,m.id):undefined}
              onClick={()=>{if(block.kind==="event") setEModal({event:events.find(e=>e.id===block.evId)});else setIModal({item:items.find(i=>i.id===block.itemId)});}}>
              <div className="tblock-title" style={{color:block.color,paddingRight:block.kind==="item"?16:0}}>{block.title}</div>
              {block.height>28&&<div className="tblock-time" style={{color:block.color}}>{block.time}</div>}
              {block.height>44&&block.note&&<div className="tblock-note" style={{color:block.color}}>{block.note}</div>}
              {block.kind==="item"&&<button className={`tblock-chk ${block.done?"on":""}`} style={{background:block.done?`${block.color}80`:"none",borderColor:block.done?block.color:`${block.color}80`}} onClick={e=>{e.stopPropagation();toggleDone(block.itemId,m.id,ds);}}>{block.done?"✓":""}</button>}
            </div>
          );
        })}
      </div>
    );
  };

  const upcomingEvs=useMemo(()=>{const res=[];for(let i=0;i<21;i++){const ds=addDays(TODAY,i);eventsOnDate(ds).forEach(ev=>res.push({...ev,_date:ds}));}return res.slice(0,12);},[eventsOnDate]);
  const lbData=useMemo(()=>[...members].map(m=>({...m,pts:netPoints(m.id)})).sort((a,b)=>b.pts-a.pts),[members,doneLog,spentPoints]);
  const maxPts=Math.max(...lbData.map(m=>m.pts),1);
  const pendingReqs=redeemReqs.filter(r=>r.status==="pending");
  const listItems=items.filter(it=>{if(it.category!==listTab)return false;if(listFmid!==null&&!it.assignedTo.includes(listFmid)&&it.assignedTo.length>0)return false;return true;});
  const dayLabel=selDate===TODAY?"Today":isoToDisplay(selDate);

  useEffect(()=>{ window._fcCats=categories; },[categories]);

  return (
    <>
      <style>{CSS}</style>
      <div className="app">

        {/* Header */}
        <header className="hdr">
          <div className="hdr-logo" style={{cursor:"pointer"}} onClick={()=>setView("home")}><LogoSVG height={44}/></div>
          <div className="hdr-members" style={{display:isMobile?"none":"flex"}}>
            <button className={`all-chip ${filterMids.size===0?"active":""}`} onClick={()=>setFilterMids(new Set())}>All</button>
            {members.map(m=>{
              const pts=netPoints(m.id), isActive=filterMids.has(m.id);
              return (
                <button key={m.id} className={`mchip ${isActive?"active":""}`}
                  style={isActive?{background:m.color,borderColor:m.color}:{}}
                  onClick={()=>toggleFilter(m.id)}>
                  <Avatar member={m} size={20}/>
                  <span className="mchip-name">{m.name}</span>
                  {pts>0&&<span className="mchip-pts">{pts}pt{pts!==1?"s":""}</span>}
                </button>
              );
            })}
          </div>
          <div className="hdr-right">
            <LiveClock/>
            {/* Mobile hamburger */}
            <div style={{position:"relative",display:isMobile?"block":"none"}}>
              <button className="hdr-gear" onClick={()=>setHamOpen(p=>!p)}>
                <svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              </button>
              {hamOpen&&(
                <>
                  <div style={{position:"fixed",inset:0,zIndex:99}} onClick={()=>setHamOpen(false)}/>
                  <div className="ham-menu">
                    <button className={`ham-item ${filterMids.size===0?"active":""}`} onClick={()=>{setFilterMids(new Set());setHamOpen(false);}}>Everyone</button>
                    {members.map(m=><button key={m.id} className={`ham-item ${filterMids.has(m.id)?"active":""}`} onClick={()=>{toggleFilter(m.id);}}><Avatar member={m} size={16}/>{m.name}</button>)}
                  </div>
                </>
              )}
            </div>
            <button className="hdr-gear" onClick={()=>setView("settings")}>{Icons.gear}</button>
          </div>
        </header>

        {/* HOME */}
        {view==="home"&&(
          <div className="page">
            {calOpen&&<div className="cal-overlay" onClick={()=>setCalOpen(false)}/>}
            <div className={`cal-drawer ${calOpen?"open":""}`}>
              <div className="cal-inner">
                <div className="cal-nav-row">
                  <div className="cal-mname">{MONTHS_SHORT[mo]} {yr}</div>
                  <div className="cal-navs">
                    <button className="ibtn" onClick={()=>setCalMo(new Date(yr,mo-1,1).getTime())}>‹</button>
                    <button className="ibtn" onClick={()=>setCalMo(new Date(yr,mo+1,1).getTime())}>›</button>
                  </div>
                </div>
                <div className="cgrid">
                  {DAYS_SHORT.map(d=><div key={d} className="cdl">{d}</div>)}
                  {cells.map((cell,i)=>{const ds=toCellDate(cell),isT=ds===TODAY,isS=ds===selDate&&!isT,hasDot=ds&&eventsOnDate(ds).length>0;return<div key={i} className={`cc${!cell.cur?" other":""}${isT?" today":""}${isS?" sel":""}${hasDot?" hasdot":""}`} onClick={()=>{if(ds){setSelDate(ds);setCalOpen(false);}}}>{cell.d}</div>;})}
                </div>
                <div className="up-lbl">Upcoming</div>
                {upcomingEvs.map((ev,i)=>(
                  <div key={i} className="uev" onClick={()=>{setEModal({event:ev});setCalOpen(false);}}>
                    <div className="uev-dot" style={{background:ev.color??SHARED_COLOR}}/>
                    <div className="uev-body"><div className="uev-title">{ev.title}</div><div className="uev-when">{ev._date===TODAY?"Today":isoToDisplay(ev._date)} · {ev.time}</div></div>
                  </div>
                ))}
                <button className="add-ev-btn" onClick={()=>{setEModal({event:null});setCalOpen(false);}}>+ Add event</button>
              </div>
            </div>

            <div className="day-view">
              <div className="day-hdr">
                <button className="cal-toggle" onClick={()=>setCalOpen(p=>!p)}>{Icons.cal}</button>
                <div className="day-nav-btns">
                  <button className="ibtn" onClick={()=>setSelDate(dayView==="day"?addDays(selDate,-1):addDays(selDate,-7))}>‹</button>
                  <button className="ibtn" onClick={()=>setSelDate(dayView==="day"?addDays(selDate,1):addDays(selDate,7))}>›</button>
                </div>
                <div className="day-title">{dayView==="week"?`Week of ${isoToDisplay(startOfWeek(selDate),{month:"short",day:"numeric"})}`:dayLabel}</div>
                {selDate!==TODAY&&<button className="day-pill" onClick={()=>setSelDate(TODAY)}>Today</button>}
                <div className="view-toggle hide-mobile">
                  <button className={`vt-btn ${dayView==="day"?"on":""}`} onClick={()=>setDayView("day")}>Day</button>
                  <button className={`vt-btn ${dayView==="week"?"on":""}`} onClick={()=>setDayView("week")}>Week</button>
                </div>
                <button className={`weekend-toggle ${showWeekends?"on":""} hide-mobile`} onClick={()=>setShowWeekends(p=>!p)}>{showWeekends?"Hide weekends":"Show weekends"}</button>
                <div className="add-dropdown" style={{position:"relative"}}>
                  <button className="add-main-btn" onClick={()=>setAddOpen(p=>!p)}>+ Add</button>
                  {addOpen&&(
                    <>
                      <div style={{position:"fixed",inset:0,zIndex:99}} onClick={()=>setAddOpen(false)}/>
                      <div className="add-menu" style={{position:"absolute",zIndex:100,right:0}}>
                        <button className="add-menu-item" onClick={()=>{setEModal({event:null});setAddOpen(false);}}>
                          <svg viewBox="0 0 24 24" style={{width:14,height:14,stroke:"currentColor",fill:"none",strokeWidth:1.8}}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                          Event
                        </button>
                        <button className="add-menu-item" onClick={()=>{setIModal({item:null,prefill:{}});setAddOpen(false);}}>
                          <svg viewBox="0 0 24 24" style={{width:14,height:14,stroke:"currentColor",fill:"none",strokeWidth:1.8}}><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                          Task
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Column headers */}
              <div className="col-hdrs" ref={colHdrsRef}>
                <div className="gutter-hdr"/>
                {dayView==="day"&&visibleMembers.map(m=>{
                  const pts=netPoints(m.id);
                  return (<div key={m.id} className="col-hdr"><Avatar member={m} size={20}/><span className="col-hdr-name">{m.name}</span>{pts>0&&<span className="col-hdr-pts" style={{background:m.color}}>{pts}pt{pts!==1?"s":""}</span>}</div>);
                })}
                {dayView==="week"&&weekDates.map(ds=>{
                  const d=new Date(ds+"T12:00:00"),isT=ds===TODAY;
                  return (<div key={ds} className="col-hdr" style={{flexDirection:"column",justifyContent:"center",cursor:"pointer",flex:"1",minWidth:showWeekends?80:110}} onClick={()=>{setSelDate(ds);setDayView("day");}}>
                    <div className="wdh-day">{DAYS_SHORT[d.getDay()]}</div>
                    <div className={`wdh-num${isT?" today-d":""}`}>{d.getDate()}</div>
                  </div>);
                })}
              </div>

              {/* Grid */}
              <div className="grid-scroll" ref={gridScrollRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
                <div className="grid-body" style={{height:totalGridHeight,minWidth:"100%"}}>
                  <div className="time-gutter" style={{height:totalGridHeight}}>
                    {hours.map(h=><div key={h} className="time-lbl" style={{top:minutesToTop(h)}}>{minutesToTime12(h)}</div>)}
                  </div>
                  {/* Banded rows */}
                  {hours.map((h,i)=>i%2===0&&<div key={h} style={{position:"absolute",left:46,right:0,top:minutesToTop(h),height:HOUR_PX,background:"rgba(240,245,250,.45)",pointerEvents:"none",zIndex:0}}/>)}
                  {/* Hour lines */}
                  {hours.map(h=><div key={h} style={{position:"absolute",left:46,right:0,top:minutesToTop(h),borderTop:"1px solid var(--bdr)",pointerEvents:"none",zIndex:1}}/>)}
                  {/* Now line */}
                  {selDate===TODAY&&nowMins>=DAY_START&&nowMins<=DAY_END&&<div className="now-line" style={{top:minutesToTop(nowMins),left:46,right:0,position:"absolute"}}/>}
                  {/* Columns */}
                  <div style={{position:"absolute",left:46,right:0,top:0,height:totalGridHeight,display:"flex"}}>
                    {dayView==="day"&&visibleMembers.map(m=>renderCol(m,selDate))}
                    {dayView==="week"&&weekDates.map(ds=>{
                      const seenItems=new Set(),allBlocks=[];
                      // Events for this day
                      const evs=eventsOnDate(ds).filter(ev=>filterMids.size===0?true:(ev.memberIds.some(id=>filterMids.has(id))||ev.memberIds.length===0));
                      evs.forEach(ev=>{const sm=timeToMinutes(ev.time);if(sm<DAY_START||sm>=DAY_END)return;allBlocks.push({id:`ev-${ev.id}`,evId:ev.id,kind:"event",top:minutesToTop(sm),height:durationToPx(ev.duration||60),startMins:sm,title:ev.title,time:ev.time,color:ev.color||SHARED_COLOR});});
                      // Items — one block per unique item (not per member)
                      const midsToShow=filterMids.size===0?members.map(m=>m.id):[...filterMids];
                      midsToShow.forEach(mid=>{
                        itemsForMemberOnDate(mid,ds).forEach(item=>{
                          if(seenItems.has(item.id))return;
                          seenItems.add(item.id);
                          if(!item.time)return;
                          const sm=timeToMinutes(item.time);
                          if(sm<DAY_START||sm>=DAY_END)return;
                          // Use member color if single assignee, else neutral
                          const assignees=item.assignedTo||[];
                          const mc=assignees.length===1?members.find(m=>m.id===assignees[0])?.color||"#8A8A8A":"#7A96A8";
                          allBlocks.push({id:`it-${item.id}`,itemId:item.id,kind:"item",top:minutesToTop(sm),height:durationToPx(item.duration||30),startMins:sm,title:item.text,time:item.time,color:mc,done:isDone(item.id,mid,ds),memberId:mid});
                        });
                      });
                      const laid=layoutBlocks(allBlocks);
                      return (
                        <div key={ds} className="pcol" style={{height:totalGridHeight,position:"relative",flex:"1",minWidth:showWeekends?80:110}} onClick={e=>{if(e.target===e.currentTarget){setSelDate(ds);setDayView("day");}}}>
                          {laid.map(block=>{const n2=Math.min(block.totalCols,3),colW2=1/n2,leftPct=block.col*colW2*100,widthPct=colW2*100;return(
                            <div key={block.id} className="tblock" style={{top:block.top,height:block.height,left:`calc(${leftPct}% + 1px)`,width:`calc(${widthPct}% - 3px)`,background:`${block.color}22`,borderLeftColor:block.color,zIndex:block.col+1}} onClick={e=>{e.stopPropagation();if(block.kind==="event") setEModal({event:events.find(ev=>ev.id===block.evId)});else setIModal({item:items.find(i=>i.id===block.itemId)});}}>
                              <div className="tblock-title" style={{color:block.color,fontSize:10}}>{block.title}</div>
                              {block.height>26&&<div className="tblock-time" style={{color:block.color,fontSize:8}}>{block.time}</div>}
                              {block.height>44&&block.note&&<div className="tblock-note" style={{color:block.color,fontSize:8}}>{block.note}</div>}
                              {block.kind==="item"&&<button className={`tblock-chk ${block.done?"on":""}`} style={{background:block.done?`${block.color}80`:"none",borderColor:block.done?block.color:`${block.color}80`,width:11,height:11,fontSize:7,top:2,right:2}} onClick={e=>{e.stopPropagation();if(block.memberId)toggleDone(block.itemId,block.memberId,ds);}}>{block.done?"✓":""}</button>}
                            </div>
                          );})}
                        </div>
                      );
                    })}
                  </div>
                  {dragging&&<div style={{position:"absolute",top:dragging.top,height:dragging.height,left:46,width:120,background:`${dragging.color}50`,border:`2px dashed ${dragging.color}`,borderRadius:6,pointerEvents:"none",zIndex:99}}><div style={{fontSize:11,fontWeight:500,color:dragging.color,padding:"3px 5px"}}>{dragging.title}</div></div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* LISTS */}
        {view==="lists"&&(
          <div className="lists-page">
            <div className="ltabs" style={{overflowX:"auto",scrollbarWidth:"none"}}>{categories.map(cat=><button key={cat.id} className={`ltab ${listTab===cat.id?"on":""}`} onClick={()=>setListTab(cat.id)}>{cat.label}</button>)}</div>
            <div className="frow">
              <button className={`fchip ${listFmid===null?"on":""}`} onClick={()=>setListFmid(null)}>All</button>
              {members.map(m=><button key={m.id} className={`fchip ${listFmid===m.id?"on":""}`} onClick={()=>setListFmid(p=>p===m.id?null:m.id)}><Avatar member={m} size={13}/>{m.name}</button>)}
            </div>
            <div className="lscroll">
              {listItems.length===0&&<div style={{textAlign:"center",padding:"24px 0",color:"var(--muted)",fontStyle:"italic",fontSize:14}}>Nothing here yet</div>}
              {listItems.map(item=>{
                const assignees=item.assignedTo.map(id=>getMember(members,id)).filter(Boolean);
                const isMulti=assignees.length>1,unassigned=assignees.length===0;
                const singleDone=!isMulti?isDone(item.id,unassigned?0:(assignees[0]?.id??0),TODAY):false;
                const allDone=isMulti&&assignees.every(m=>isDone(item.id,m.id,TODAY));
                const itemDone=isMulti?allDone:singleDone;
                return (
                  <div key={item.id} className={`li${itemDone?" done":""}`} style={{flexDirection:"column",alignItems:"stretch",gap:5}} onClick={()=>setIModal({item})}>
                    <div style={{display:"flex",alignItems:"center",gap:7}}>
                      {!isMulti&&<button className={`lchk${singleDone?" on":""}`} onClick={e=>{e.stopPropagation();toggleDone(item.id,unassigned?0:(assignees[0]?.id??0),TODAY);}}>{singleDone?"✓":""}</button>}
                      <div className="li-body">
                        <div className="li-text" style={{textDecoration:itemDone?"line-through":"none"}}>{item.text}</div>
                        <div className="li-meta">
                          {!isMulti&&assignees.length>0&&<Avatar member={assignees[0]} size={12}/>}
                          <span className="li-who">{unassigned?"Anyone":isMulti?"Multiple":assignees[0]?.name}</span>
                          {item.time&&<span className="li-tag">{item.time}</span>}
                          {item.repeat!=="none"&&<span className="li-tag">{item.repeat==="weekly-dow"?"weekly":item.repeat}</span>}
                          {item.note&&<span className="li-note">{item.note}</span>}
                        </div>
                      </div>
                      {item.points>0&&<div className="pbadge">{item.points}pt · {dFmt(item.points*rate)}</div>}
                    </div>
                    {isMulti&&<div style={{display:"flex",flexWrap:"wrap",gap:4,paddingLeft:4}} onClick={e=>e.stopPropagation()}>
                      {assignees.map(m=>{const done=isDone(item.id,m.id,TODAY);return(
                        <button key={m.id} onClick={e=>{e.stopPropagation();toggleDone(item.id,m.id,TODAY);}}
                          style={{display:"flex",alignItems:"center",gap:3,padding:"3px 8px 3px 4px",borderRadius:100,border:`1.5px solid ${done?m.color:"var(--bdr)"}`,background:done?`${m.color}18`:"none",cursor:"pointer",fontSize:11,color:done?m.color:"var(--ink2)",fontFamily:"DM Sans,sans-serif"}}>
                          <div style={{width:13,height:13,borderRadius:3,border:`2px solid ${done?m.color:"var(--bdr)"}`,background:done?m.color:"none",display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:"#fff",flexShrink:0}}>{done?"✓":""}</div>
                          <Avatar member={m} size={12}/>{m.name}
                        </button>
                      );})}
                    </div>}
                  </div>
                );
              })}
            </div>
            <div className="labar">
              <input className="ainput" value={aText} onChange={e=>setAText(e.target.value)} placeholder={`Add to ${categories.find(c=>c.id===listTab)?.label||listTab}…`} onKeyDown={e=>e.key==="Enter"&&addQuick()}/>
              <input className="pinput" type="number" min="0" value={aPts} onChange={e=>setAPts(e.target.value)} title="Points"/>
              <button className="abtn" onClick={addQuick}>Add</button>
            </div>
          </div>
        )}

        {/* POINTS */}
        {view==="points"&&(
          <div className="pts-page">
            <div className="ltabs">
              <button className={`ltab ${ptsTab==="lb"?"on":""}`} onClick={()=>setPtsTab("lb")}>Leaderboard</button>
              <button className={`ltab ${ptsTab==="store"?"on":""}`} onClick={()=>setPtsTab("store")}>Rewards Store</button>
            </div>
            {ptsTab==="lb"&&(
              <div className="pts-scroll">
                <div style={{background:"var(--gold-lt)",border:"1.5px solid var(--gold-bd)",borderRadius:10,padding:"9px 14px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span style={{fontSize:13,color:"var(--ink2)"}}>1 point equals</span>
                  <span style={{fontSize:17,fontWeight:700,color:"var(--gold)"}}>{dFmt(rate)}</span>
                </div>
                {lbData.map((m,i)=>(
                  <div key={m.id} className="lbc">
                    <div className={`lbc-rank${i===0?" r1":i===1?" r2":i===2?" r3":""}`}>{i+1}</div>
                    <Avatar member={m} size={30}/>
                    <div className="lbc-info"><div className="lbc-name">{m.name}</div><div className="lbc-bar"><div className="lbc-fill" style={{width:`${(Math.max(m.pts,0)/maxPts)*100}%`,background:m.color}}/></div></div>
                    <div className="lbc-right"><div className="lbc-dollar">{dFmt(Math.max(m.pts,0)*rate)}</div><div className="lbc-pts">{m.pts} pts</div>{(spentPoints[m.id]||0)>0&&<div className="lbc-spent">spent: {spentPoints[m.id]}pt</div>}</div>
                  </div>
                ))}
                {pendingReqs.length>0&&(
                  <><div style={{fontSize:14,fontWeight:500,margin:"12px 0 7px"}}>Pending Requests</div>
                  {pendingReqs.map(req=>{const rw=rewards.find(r=>r.id===req.rewardId),mem=getMember(members,req.memberId);if(!rw||!mem)return null;return(
                    <div key={req.id} className="req-card">
                      <div style={{color:"var(--sky)"}}><RewardIcon icon={rw.icon}/></div>
                      <div className="req-body"><div className="req-name">{rw.title}</div><div className="req-who">{mem.name} · {rw.points} pts</div></div>
                      <div className="req-actions"><button className="req-approve" onClick={()=>approveReq(req.id)}>Approve</button><button className="req-decline" onClick={()=>declineReq(req.id)}>Decline</button></div>
                    </div>
                  );})} </>
                )}
              </div>
            )}
            {ptsTab==="store"&&(
              <div className="pts-scroll">
                <div style={{background:"var(--gold-lt)",border:"1.5px solid var(--gold-bd)",borderRadius:10,padding:"9px 14px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span style={{fontSize:13,color:"var(--ink2)"}}>1 point equals</span>
                  <span style={{fontSize:17,fontWeight:700,color:"var(--gold)"}}>{dFmt(rate)}</span>
                </div>
                <div className="store-title">Rewards Store</div>
                <div className="store-sub">Tap a reward to request it. Parents approve from Leaderboard.</div>
                <div className="reward-grid">
                  {rewards.map(r=>(
                    <div key={r.id} className="reward-card" onClick={()=>setRdModal({reward:r})}>
                      <div className="reward-card-body"><RewardIcon icon={r.icon}/><div className="reward-title">{r.title}</div></div>
                      <div className="reward-pts">{r.points} pts · {dFmt(r.points*rate)}</div>
                    </div>
                  ))}
                  <div className="reward-card" style={{border:"1.5px dashed var(--bdr)",background:"none",cursor:"pointer"}} onClick={()=>setRwModal({reward:null})}>
                      <div className="reward-card-body" style={{justifyContent:"center"}}><div style={{color:"var(--muted)",fontSize:13,fontWeight:500}}>+ Add reward</div></div>
                    </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SETTINGS */}
        {view==="settings"&&(
          <div className="set-page">
            <div className="set-sec">
              <div className="set-sec-title">Family Members</div>
              <div className="set-sec-sub">Tap to edit name, photo, color, or email</div>
              {members.map(m=>(
                <div key={m.id} className="mer" onClick={()=>setMModal({member:m})}>
                  <Avatar member={m} size={28}/>
                  <div className="mer-info"><div className="mer-name">{m.name}</div><div className="mer-sub">{m.email||"No email"}</div></div>
                  <div style={{fontSize:11,color:m.color,fontWeight:600}}>{netPoints(m.id)} pts</div>
                  <div className="mer-arrow">›</div>
                </div>
              ))}
              <button className="add-dashed" onClick={()=>setMModal({member:null})}>+ Add family member</button>
            </div>
            <div className="set-sec">
              <div className="set-sec-title">Rewards Store</div>
              <div className="set-sec-sub">Manage rewards kids can earn</div>
              {rewards.map(r=>(
                <div key={r.id} className="mer" onClick={()=>setRwModal({reward:r})}>
                  <div style={{color:"var(--sky)"}}><RewardIcon icon={r.icon}/></div>
                  <div className="mer-info"><div className="mer-name">{r.title}</div><div className="mer-sub">{r.points} pts · {dFmt(r.points*rate)}</div></div>
                  <div className="mer-arrow">›</div>
                </div>
              ))}
              <button className="add-dashed" onClick={()=>setRwModal({reward:null})}>+ Add reward</button>
            </div>
            <div className="set-sec">
              <div className="set-sec-title">List Categories</div>
              <div className="set-sec-sub">Customize your list tabs</div>
              {categories.map((cat,i)=>(
                <div key={cat.id} className="set-row" style={{gap:6}}>
                  <input className="min" style={{flex:1,fontSize:13,padding:"6px 10px"}} value={cat.label}
                    onChange={e=>setCategories(cs=>cs.map((c,j)=>j===i?{...c,label:e.target.value}:c))}/>
                  {categories.length>1&&<button onClick={()=>{setCategories(cs=>cs.filter((_,j)=>j!==i));if(listTab===cat.id)setListTab(categories[0]?.id||"chores");}}
                    style={{padding:"6px 10px",borderRadius:7,border:"none",background:"#F0D8D0",color:"#8A3A2A",fontFamily:"DM Sans,sans-serif",fontSize:12,cursor:"pointer"}}>Remove</button>}
                </div>
              ))}
              <button className="add-dashed" onClick={()=>{const id="cat_"+Date.now();setCategories(cs=>[...cs,{id,label:"New List"}]);setListTab(id);}}>+ Add category</button>
            </div>
            <div className="set-sec">
              <div className="set-sec-title">Points & Dollars</div>
              <div className="set-sec-sub">Only parents should change this</div>
              <div className="rate-display">
                <div><div className="rate-display-lbl">1 point =</div></div>
                <div className="rate-display-val">{dFmt(rate)}</div>
              </div>
              <div className="set-row">
                <div className="set-row-lbl">Point value</div>
                <div className="rate-edit-row"><span className="rsym">$</span><input className="rin" type="number" min="0.01" step="0.05" value={rate} onChange={e=>setRate(Math.max(0.01,parseFloat(e.target.value)||0.01))}/><span style={{fontSize:12,color:"var(--muted)"}}>/ pt</span></div>
              </div>
            </div>
            <div className="set-sec">
              <div className="set-sec-title">Reward Period</div>
              <div className="set-row">
                <div><div className="set-row-lbl">Period length</div><div className="set-row-sub">Started {isoToDisplay(periodStart)}</div></div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <input className="period-input" type="number" min="1" max="90" value={periodDays} onChange={e=>setPeriodDays(Math.max(1,Math.min(90,parseInt(e.target.value)||14)))}/>
                  <span style={{fontSize:12,color:"var(--muted)"}}>days</span>
                </div>
              </div>
              <div className="set-row">
                <div><div className="set-row-lbl">Reset period now</div><div className="set-row-sub">Clears completed items, keeps history</div></div>
                <button className="reset-btn" onClick={()=>setConfirmModal({title:"Reset period?",message:`Starts a fresh ${periodDays}-day period.`,onConfirm:resetPeriod})}>Reset</button>
              </div>
            </div>
            <div className="set-sec">
              <div className="set-sec-title">Account</div>
              <div className="set-row">
                <div className="set-row-lbl">Subscription</div>
                <a href="/subscription.html" style={{fontSize:12,color:"var(--sky)",textDecoration:"none",fontWeight:500}}>Manage</a>
              </div>
              <div className="set-row" style={{opacity:.5}}>
                <div className="set-row-lbl">Google Calendar sync</div>
                <span style={{fontSize:12,color:"var(--muted)"}}>Coming soon</span>
              </div>
              <button className="sign-out-btn" onClick={onLogout}>Sign out</button>
            </div>
          </div>
        )}

        <nav className="nav">
          {[{id:"home",lbl:"Home",icon:Icons.home},{id:"lists",lbl:"Lists",icon:Icons.list},{id:"points",lbl:"Points",icon:Icons.star},{id:"settings",lbl:"Settings",icon:Icons.gear}].map(n=>(
            <button key={n.id} className={`nbtn ${view===n.id?"on":""}`} onClick={()=>setView(n.id)}>{n.icon}{n.lbl}</button>
          ))}
        </nav>
      </div>

      {iModal&&<ItemModal item={iModal.item} members={members} prefill={iModal.prefill} onSave={p=>{saveItem(iModal.item?.id,iModal.item?p:{...p,...(iModal.prefill||{})});setIModal(null);}} onDelete={()=>{delItem(iModal.item.id);setIModal(null);}} onClose={()=>setIModal(null)}/>}
      {eModal&&<EventModal event={eModal.event} members={members} onSave={p=>{saveEvent(eModal.event?.id,p);setEModal(null);}} onDelete={()=>{delEvent(eModal.event.id);setEModal(null);}} onClose={()=>setEModal(null)}/>}
      {mModal&&<MemberModal member={mModal.member} onSave={p=>{saveMember(mModal.member?.id,p);setMModal(null);}} onDelete={()=>{delMember(mModal.member.id);setMModal(null);}} onClose={()=>setMModal(null)}/>}
      {rwModal&&<RewardModal reward={rwModal.reward} onSave={p=>{saveReward(rwModal.reward?.id,p);setRwModal(null);}} onDelete={()=>{delReward(rwModal.reward.id);setRwModal(null);}} onClose={()=>setRwModal(null)}/>}
      {rdModal&&<RedeemModal reward={rdModal.reward} members={members} earnedInPeriod={earnedInPeriod} spentPoints={spentPoints} onSubmit={mid=>{submitRedeem(rdModal.reward.id,mid);setRdModal(null);}} onClose={()=>setRdModal(null)}/>}
      {confirmModal&&<ConfirmModal title={confirmModal.title} message={confirmModal.message} onConfirm={confirmModal.onConfirm} onClose={()=>setConfirmModal(null)}/>}
    </>
  );
}

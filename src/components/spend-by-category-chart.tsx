"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { formatCompact } from "@/lib/format";
interface DataItem { category: string | null; total: number; count: number; }
export function SpendByCategoryChart({ data }: { data: DataItem[] }) {
 const top=data.slice(0,8);
 const other=data.slice(8).reduce((sum,row)=>sum+row.total,0);
 const chartData=[...top.map(row=>({name:row.category||"No category",value:row.total})),...(data.length>8?[{name:"Other categories",value:other}]:[])];
 return <div className="rounded-xl border bg-white p-5 shadow-sm">
  <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Net payments by publisher category</h3>
  {!chartData.length?<p className="py-8 text-center text-gray-500">No data available</p>:<ResponsiveContainer width="100%" height={380}>
   <BarChart data={chartData} layout="vertical" margin={{left:8,right:25}}>
    <XAxis type="number" tickFormatter={formatCompact} tick={{fontSize:11}}/>
    <YAxis type="category" dataKey="name" width={150} tick={{fontSize:11}} tickFormatter={(s:string)=>s.length>25?s.slice(0,24)+"…":s}/>
    <Tooltip formatter={(v)=>[formatCompact(Number(v)),"Net payments"]}/>
    <ReferenceLine x={0} stroke="#94a3b8"/>
    <Bar dataKey="value" fill="#1d4ed8" isAnimationActive={false}/>
   </BarChart>
  </ResponsiveContainer>}
  <p className="mt-2 text-xs text-gray-500">Credits and refunds remain negative. Categories reflect each council’s published labels.</p>
 </div>;
}

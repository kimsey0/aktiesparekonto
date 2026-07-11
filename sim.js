/* The calculation logic behind jacobbundgaard.dk/aktiesparekonto — pure math, no DOM.
 * Runs directly in Node for testing and auditing:  const sim = require('./sim.js')
 * Every function takes a parameter object P — see readParams() in index.html for the fields.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ASKSIM = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  "use strict";

  function aktieTax(gain, thr, low, high){
    if(gain<=0) return 0;
    return Math.min(gain,thr)*low + Math.max(0,gain-thr)*high;
  }
  // aktieindkomst tax on `gain`, given `used` kr of the year's low-rate band already consumed
  function bracketTax(gain, thr, used, low, high){
    if(gain<=0) return 0;
    const lowPart=Math.min(gain, Math.max(0, thr-used));
    return lowPart*low + (gain-lowPart)*high;
  }

  // sell enough of an average-cost position that the seller nets `target` after
  // realisation tax and commission (grossed up; capped at the position's value).
  // Fixed-point iteration — the tax+fee fraction is well below 1, so it contracts.
  function sellForNet(a, target, thr, used, P){
    const gainFrac = a.v>0 ? Math.max(0, a.v-a.basis)/a.v : 0;
    let gross=target;
    for(let i=0;i<8;i++){
      const tax=bracketTax(gross*gainFrac, thr, used, P.taxLow, P.taxHigh);
      const fee=Math.max(P.feePct*gross, P.feeMin);
      gross=Math.min(a.v, target+tax+fee);
    }
    const rg=gross*gainFrac;
    const tax=bracketTax(rg, thr, used, P.taxLow, P.taxHigh);
    const fee=Math.max(P.feePct*gross, P.feeMin);
    return {gross, rg, tax, fee, net: gross-tax-fee};
  }

  // Final drawdown of a realisation position, simulated year by year: what is
  // not yet sold stays invested at gross-TER and keeps distributing, and each
  // year's sale is taxed against that year's band. thrOf(k) = the progression
  // threshold k years after the first sale year; usedFirst = band already
  // consumed in the first sale year (that year's dividends/harvest/refill);
  // P.threshUsed consumes band in every later year too.
  // In kink mode, targetYears gives a bucket with band slack a common window to
  // spread into (set by the slower strategy) instead of exiting early and
  // idling — summing cash received in different decades would be unfair. Kink
  // windows are capped at 30 years: what the band hasn't absorbed by then is
  // force-sold (partly at the high rate) and flagged via `forced`.
  // Returns nominal totals plus the per-year net withdrawals (wd) so the
  // caller can deflate each one by its own payout year.
  function drawdown(value, basis, P, thrOf, usedFirst, targetYears){
    const out={tax:0, fee:0, years:0, after:0, wd:[], forced:false};
    if(value<=1){ out.after=Math.max(0,value); return out; }
    const r=Math.max(-0.99, P.gross-P.taxTer);
    const MAXY=30;
    const N=P.drawMode==='kink' ? (targetYears||MAXY) : Math.min(100, Math.max(1, Math.round(P.liqYears)));
    let v=value, b=basis;
    for(let k=0; k<100; k++){
      let used = k===0 ? usedFirst : P.threshUsed;
      if(k>0){
        // distributions accrue to the holdings at the start of the year
        const divBase=v;
        v*=(1+r);
        const div=P.taxDiv*divBase;
        if(div>0){
          const dt=bracketTax(div, thrOf(k), used, P.taxLow, P.taxHigh);
          used+=div;
          if(P.divMode==='tech'){ b+=div; b-=dt*(b/v); v-=dt; }
          else { v-=dt; b+=div-dt; }
          out.tax+=dt;
        }
      }
      const gain=Math.max(0, v-b);
      let sell;
      if(P.drawMode==='kink'){
        // sell just enough gain to fill the year's remaining low band; a bucket
        // given a common window spreads evenly into it instead; the final window
        // year force-sells whatever the band hasn't absorbed
        const band=Math.max(0, thrOf(k)-used);
        if(k>=N-1){ sell=v; if(gain>band) out.forced=true; }
        else {
          sell = gain<=band ? v : Math.min(v, band*v/gain);
          if(targetYears) sell=Math.min(sell, v/(N-k));
        }
      } else {
        sell = k>=N-1 ? v : v/(N-k);
      }
      let net=0;
      if(sell>0.01){
        const rg=sell*gain/v;
        const tax=bracketTax(rg, thrOf(k), used, P.taxLow, P.taxHigh);
        const fee=Math.max(P.feePct*sell, P.feeMin);
        net=Math.max(0, sell-tax-fee);
        b-=sell*(b/v); v-=sell;
        out.tax+=tax; out.fee+=fee; out.after+=net;
      }
      // rem = market value still invested after this year's sale (for the chart)
      out.wd.push({net, k, rem: Math.max(0, v)});
      out.years=k+1;
      if(v<=1) break;
    }
    return out;
  }

  // Parallel drawdown of the ASK over N years: the account stays invested and
  // mark-to-market taxed until sold; each sale pays ASK commission and FX.
  // Both are paid inside the account and thus remain deductible via the loss
  // carryforward — which lapses when the account closes in the final year.
  function askDrawdown(value, carry, P, N){
    const out={tax:0, fee:0, fx:0, years:0, after:0, wd:[]};
    if(value<=1){ out.after=Math.max(0,value); return out; }
    let v=value;
    for(let k=0; k<N && v>1; k++){
      if(k>0){
        const yStart=v;
        v*=(1+Math.max(-0.99, P.gross-P.askTer));
        let tg=v-yStart-carry, tax=0;
        if(tg>0){ tax=tg*P.askTax; carry=0; } else carry=-tg;
        v-=tax; out.tax+=tax;
      }
      const sell = k>=N-1 ? v : v/(N-k);
      const fee=Math.max(P.askFeePct*sell, P.askFeeMin);
      const fx=Math.max(0, sell-fee)*P.askForex;
      const net=Math.max(0, sell-fee-fx);
      carry+=sell-net;   // costs paid inside the account stay deductible
      v-=sell;
      out.fee+=fee; out.fx+=fx; out.after+=net; out.wd.push({net, k, rem: Math.max(0, v)});
      out.years=k+1;
    }
    return out;
  }

  function simulate(P){
    const months=P.horizon*12;
    const rAsk=Math.pow(Math.max(0.01, 1+P.gross-P.askTer),1/12)-1;
    const rTax=Math.pow(Math.max(0.01, 1+P.gross-P.taxTer),1/12)-1;
    // married: each spouse can hold their own ASK (double ceiling), and unused
    // progression threshold transfers between cohabiting spouses (PSL § 8 a, stk. 4).
    const mar=P.married?2:1;
    const thrBase=P.threshold*mar;
    // the already-enacted extra uplift of the progression threshold from 2027
    // (its own parameter, stated in 2026-level kroner); § 20-adjusted by P.reg
    const thr27Base=(P.threshold27===undefined?P.threshold:P.threshold27)*mar;
    const ceilBase=P.askCeiling*mar;
    const thrAt = y => y===0 ? thrBase : thr27Base*Math.pow(1+P.reg,y);
    let thrY=thrBase;   // this year's progression threshold

    let ask={v:0,yStart:0,contribYr:0,carry:0,taxLast:0,taxCum:0,feeCum:0,fxCum:0};
    let ov ={v:0,basis:0,divBase:0,usedYr:0,taxCum:0,feeCum:0};   // overflow taxable (strategy A)
    let all={v:0,basis:0,divBase:0,taxCum:0,feeCum:0};            // all taxable (strategy B)
    let budget=0, firstOverflow=null;
    const series=[];

    // realise gain up to the remaining low-rate band, then buy back (steps up basis).
    // returns the band consumed so later events in the same year price correctly.
    function harvest(a, used){
      if(!P.harvest) return 0;
      const gain=Math.max(0, a.v-a.basis);
      const g=Math.min(Math.max(0, thrY-used), gain);
      if(g<=1) return 0;
      const notional=g/(gain/a.v);                  // shares sold to realise g
      const tax=g*P.taxLow;                          // within the band by construction
      const fee=2*Math.max(P.feePct*notional, P.feeMin);  // sell + buy
      a.v-=(tax+fee); a.basis+=(g-tax-fee);
      a.taxCum+=tax; a.feeCum+=fee;
      return g;
    }

    // the year's distribution/minimumsindkomst, taxed as share income and based
    // on the holdings at the start of the year (a.divBase — the funds' ex-dates
    // are Feb-Apr, so later purchases only join next year). 'cash' (SPIIMA/
    // SPVIGAKL): the dividend is paid out, tax is paid from it, and the rest is
    // reinvested — value drops by the tax, cost basis rises by the net amount.
    // 'tech' (STIIAM): nothing is paid out — the cost basis is stepped up by the gross
    // amount, and the tax is funded by selling a sliver of the holding (the gain and
    // trading fee on that tiny sale are ignored as second-order).
    function divEvent(a, used){
      const div=P.taxDiv*a.divBase;
      if(div<=0 || a.v<=0) return 0;
      const dt=bracketTax(div,thrY,used,P.taxLow,P.taxHigh);
      if(P.divMode==='tech'){ a.basis+=div; a.basis-=dt*(a.basis/a.v); a.v-=dt; }
      else { a.v-=dt; a.basis+=div-dt; }
      a.taxCum+=dt;
      return div;
    }

    // sell grossed-up from the overflow depot and deposit the net into the ASK,
    // so the deposited cash equals the intended amount; the ASK-side buy pays
    // ASK commission and FX, both implicitly deductible (deposits count gross
    // in the mark-to-market base).
    function fundAsk(target, used){
      const s=sellForNet(ov, Math.min(target, ov.v), thrY, used, P);
      if(s.net<=1) return null;
      ov.basis-=s.gross*(ov.basis/ov.v); ov.v-=s.gross;
      ov.taxCum+=s.tax; ov.feeCum+=s.fee;
      const fee=Math.max(P.askFeePct*s.net, P.askFeeMin);
      const netAsk=(s.net-fee)*(1-P.askForex);
      ask.v+=netAsk; ask.feeCum+=fee; ask.fxCum+=(s.net-fee)*P.askForex;
      budget-=s.net;
      return {deposited:s.net, netAsk, rg:s.rg};
    }

    for(let m=0;m<months;m++){
      const y=Math.floor(m/12), mi=m%12;
      if(mi===0){
        const ceiling=ceilBase*Math.pow(1+P.reg,y);
        thrY=thrAt(y);
        // headroom = ceiling minus the 31 Dec value (the tax has not yet been
        // withdrawn at the measurement date, so it is added back) + the tax itself,
        // which may always be re-deposited (aktiesparekontoloven § 9, stk. 2).
        budget=Math.max(0,ceiling-(ask.v+ask.taxLast))+ask.taxLast;
        ask.yStart=ask.v; ask.contribYr=0;
        ov.usedYr=P.threshUsed;
      }
      const contrib=P.monthly+(m===0?P.initial:0);
      let toAsk=Math.min(budget,contrib); budget-=toAsk;
      let toOv=contrib-toAsk;
      if(toOv>1 && firstOverflow===null) firstOverflow=y+1;

      // buy-side kurtage: recurring buys through månedsopsparing (P.msAsk/P.msDepot)
      // are commission-free; without it every buy pays the normal trading fee —
      // the ASK schedule for ASK buys, the depot schedule for depot buys.
      // Purchase fees join the cost basis in the taxable account (as in the actual
      // assessment), so basis counts the gross amount while value receives net.
      // ASK deposits also count gross in the mark-to-market base, which makes both
      // the buy fee and the FX cost implicitly deductible there.
      const buyFeeAsk=(!P.msAsk && toAsk>0) ? Math.max(P.askFeePct*toAsk, P.askFeeMin) : 0;
      ask.v+=(toAsk-buyFeeAsk)*(1-P.askForex); ask.fxCum+=(toAsk-buyFeeAsk)*P.askForex;
      ask.contribYr+=toAsk; ask.feeCum+=buyFeeAsk;

      const buyFeeOv=(!P.msDepot && toOv>0) ? Math.max(P.feePct*toOv, P.feeMin) : 0;
      ov.v+=toOv-buyFeeOv; ov.basis+=toOv; ov.feeCum+=buyFeeOv;
      const buyFeeAll=(!P.msDepot && contrib>0) ? Math.max(P.feePct*contrib, P.feeMin) : 0;
      all.v+=contrib-buyFeeAll; all.basis+=contrib; all.feeCum+=buyFeeAll;

      if(mi===0){
        // January refill: the allowance is known at the start of the year, so the
        // part the coming months' contributions won't cover is funded from the
        // overflow depot right away rather than sitting taxable for a year.
        const target=Math.max(0, budget-11*P.monthly);
        if(P.redeposit && target>1 && ov.v>1){
          const f=fundAsk(target, ov.usedYr);
          if(f){ ask.contribYr+=f.deposited; ov.usedYr+=f.rg; }
        }
        // dividend entitlement snapshot (after the January contribution/refill)
        ov.divBase=ov.v; all.divBase=all.v;
      }

      ask.v*=(1+rAsk); ov.v*=(1+rTax); all.v*=(1+rTax);

      if(mi===11){
        const lastYear = (y===P.horizon-1);
        // ASK mark-to-market tax (withdrawn from the account)
        const gain=ask.v-ask.yStart-ask.contribYr;
        let tg=gain-ask.carry, lagerTax=0;
        if(tg>0){ lagerTax=tg*P.askTax; ask.carry=0; } else { ask.carry=-tg; }
        ask.v-=lagerTax; ask.taxCum+=lagerTax; ask.taxLast=lagerTax;

        // strategy A overflow: dividend -> December catch-all refill -> harvest
        let usedA=ov.usedYr;
        usedA+=divEvent(ov, usedA);
        // catch-all for allowance the January refill and the year's contributions
        // didn't cover (e.g. the depot ran dry in January); deposited after this
        // year's taxation, so its costs are carried as a deductible loss instead
        const shortfall=Math.max(0, budget);
        if(P.redeposit && shortfall>1 && ov.v>1){
          const f=fundAsk(shortfall, usedA);
          if(f){ ask.carry+=f.deposited-f.netAsk; usedA+=f.rg; }
        }
        if(!lastYear) usedA+=harvest(ov, usedA);   // harvesting in the sale year only adds fees

        // strategy B: dividend -> harvest
        let usedB=P.threshUsed;
        usedB+=divEvent(all, usedB);
        if(!lastYear) usedB+=harvest(all, usedB);

        // after-tax withdrawals if the sale starts this year, using the chosen
        // drawdown strategy; the ASK is withdrawn in parallel over the same years.
        // In kink mode the strategy that needs the longest band-limited exit sets
        // the common window, and buckets with slack spread evenly into it.
        const thrOf=k=>thrAt(y+k);
        let dOv=drawdown(ov.v, ov.basis, P, thrOf, usedA);
        let dAll=drawdown(all.v, all.basis, P, thrOf, usedB);
        let NA=Math.min(100, Math.max(1,Math.round(P.liqYears)));
        if(P.drawMode==='kink'){
          NA=Math.max(1, dOv.years, dAll.years);
          if(dOv.years && dOv.years<NA) dOv=drawdown(ov.v, ov.basis, P, thrOf, usedA, NA);
          if(dAll.years && dAll.years<NA) dAll=drawdown(all.v, all.basis, P, thrOf, usedB, NA);
        }
        const dAsk=askDrawdown(ask.v, ask.carry, P, NA);
        // real mode deflates each withdrawal by its own payout year
        const defl=k=>Math.pow(1+P.infl, y+1+k);
        const realSum=w=>w.reduce((s,x)=>s+x.net/defl(x.k),0);
        series.push({year:y+1,
          A:dAsk.after+dOv.after, B:dAll.after,
          Areal:realSum(dAsk.wd)+realSum(dOv.wd), Breal:realSum(dAll.wd),
          ask:dAsk.after, askReal:realSum(dAsk.wd),
          dOv, dAll, dAsk});
      }
    }
    const contributed=P.initial+P.monthly*months;
    const last=series[series.length-1];
    // the payout path of the final sale, year by year, for the chart's
    // drawdown wedge: cumulative net cash received vs market value still
    // invested (nominal and deflated by each year's own inflation factor)
    const wdAt=(d,k)=>d.wd[k]||{net:0,rem:0};
    const dLen=Math.max(last.dAsk.wd.length, last.dOv.wd.length, last.dAll.wd.length);
    const deflD=k=>Math.pow(1+P.infl, P.horizon+k);
    const drawSeries=[];
    for(let k=0,cA=0,cB=0,cAr=0,cBr=0;k<dLen;k++){
      const a1=wdAt(last.dAsk,k), a2=wdAt(last.dOv,k), b=wdAt(last.dAll,k);
      cA+=a1.net+a2.net; cB+=b.net;
      cAr+=(a1.net+a2.net)/deflD(k); cBr+=b.net/deflD(k);
      drawSeries.push({k,
        cashA:cA, remA:a1.rem+a2.rem, cashB:cB, remB:b.rem,
        cashAreal:cAr, remAreal:(a1.rem+a2.rem)/deflD(k),
        cashBreal:cBr, remBreal:b.rem/deflD(k)});
    }
    return {
      series, firstOverflow, contributed, drawSeries,
      A_after: last.A, B_after: last.B,
      A_real: last.Areal, B_real: last.Breal,
      askFinal: last.ask, overflowFinal: last.dOv.after,
      A_tax: ask.taxCum + ov.taxCum + last.dOv.tax + last.dAsk.tax,
      B_tax: all.taxCum + last.dAll.tax,
      A_fee: ask.feeCum + ov.feeCum + last.dOv.fee + last.dAsk.fee,
      B_fee: all.feeCum + last.dAll.fee,
      A_fx: ask.fxCum + last.dAsk.fx,
      A_years: last.dOv.years, B_years: last.dAll.years,
      A_forced: last.dOv.forced, B_forced: last.dAll.forced
    };
  }

  return { aktieTax, bracketTax, sellForNet, drawdown, askDrawdown, simulate };
});

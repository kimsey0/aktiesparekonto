/* Beregningslogikken bag jacobbundgaard.dk/aktiesparekonto — ren matematik, ingen DOM.
 * Kan køres direkte i Node til test/audit:  const sim = require('./sim.js')
 * Alle funktioner tager et parameterobjekt P — se readParams() i index.html for felterne.
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
  // final drawdown of a realisation position: tax, trading fee, and years it takes.
  // thr0 = progressionsgrænsen in the sale year (keeps growing with P.reg in later
  // sale years); usedFirst = band already consumed in the first sale year (that
  // year's dividends/harvest); P.threshUsed consumes band in every later year too.
  function drawdown(value, basis, P, thr0, usedFirst){
    if(value<=1) return {tax:0, fee:0, years:0, after:value};
    const gain=Math.max(0, value-basis);
    const band = k => Math.max(0, thr0*Math.pow(1+P.reg,k) - (k===0?usedFirst:P.threshUsed));
    let years, tax;
    if(P.drawMode==='kink'){
      // sell just enough gain each year to stay inside the low band
      let cap=0; years=0;
      while(cap<gain && years<100){ cap+=band(years); years++; }
      years=Math.max(1,years);
      tax = Math.min(gain,cap)*P.taxLow + Math.max(0,gain-cap)*P.taxHigh;
    } else {
      years = Math.max(1, Math.round(P.liqYears));
      tax = 0;
      for(let k=0;k<years;k++) tax += aktieTax(gain/years, band(k), P.taxLow, P.taxHigh);
    }
    const fee = Math.max(P.feePct*value, years*P.feeMin);
    return {tax, fee, years, after: value - tax - fee};
  }

  function simulate(P){
    const months=P.horizon*12;
    const rAsk=Math.pow(1+P.gross-P.askTer,1/12)-1;
    const rTax=Math.pow(1+P.gross-P.taxTer,1/12)-1;
    // gift: hver ægtefælle kan have sin egen ASK (dobbelt loft), og uudnyttet
    // progressionsgrænse overføres mellem samlevende ægtefæller (PSL § 8 a, stk. 4).
    const thrBase=P.threshold*(P.married?2:1);
    const ceilBase=P.askCeiling*(P.married?2:1);
    let thrY=thrBase;   // årets progressionsgrænse — § 20-reguleret med P.reg

    let ask={v:0,yStart:0,contribYr:0,carry:0,taxLast:0,taxCum:0};
    let ov ={v:0,basis:0,taxCum:0,feeCum:0};   // overflow taxable (strategy A)
    let all={v:0,basis:0,taxCum:0,feeCum:0};   // all taxable (strategy B)
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

    // årets udbytte/minimumsindkomst, beskattet som aktieindkomst. 'cash' (SPIIMA/
    // SPVIGAKL): udbyttet udbetales, skatten betales af det, resten geninvesteres —
    // værdien falder med skatten, anskaffelsessummen stiger med nettobeløbet.
    // 'tech' (STIIAM): ingen udbetaling — anskaffelsessummen opskrives med brutto-
    // beløbet, og skatten finansieres ved at sælge lidt af beholdningen (gevinst og
    // kurtage på dette lille salg ignoreres som andenordens).
    function divEvent(a, used){
      const div=P.taxDiv*a.v;
      if(div<=0) return 0;
      const dt=bracketTax(div,thrY,used,P.taxLow,P.taxHigh);
      if(P.divMode==='tech'){ a.basis+=div; a.basis-=dt*(a.basis/a.v); a.v-=dt; }
      else { a.v-=dt; a.basis+=div-dt; }
      a.taxCum+=dt;
      return div;
    }

    for(let m=0;m<months;m++){
      const y=Math.floor(m/12), mi=m%12;
      if(mi===0){
        const ceiling=ceilBase*Math.pow(1+P.reg,y);
        thrY=thrBase*Math.pow(1+P.reg,y);
        // plads = loft minus værdien pr. 31/12 (skatten er endnu ikke hævet på
        // opgørelsestidspunktet, så den lægges tilbage) + skatten selv, som altid
        // må genindskydes (aktiesparekontolovens § 9, stk. 2).
        budget=Math.max(0,ceiling-(ask.v+ask.taxLast))+ask.taxLast;
        ask.yStart=ask.v; ask.contribYr=0;
      }
      const contrib=P.monthly+(m===0?P.initial:0);
      let toAsk=Math.min(budget,contrib); budget-=toAsk;
      let toOv=contrib-toAsk;
      if(toOv>1 && firstOverflow===null) firstOverflow=y+1;

      // indskud tæller brutto i lagerbeskatningen — vekselomkostningen er dermed
      // implicit fradragsberettiget, som i den faktiske opgørelse (værdi minus indskud)
      const askNet=toAsk*(1-P.askForex);
      ask.v+=askNet; ask.contribYr+=toAsk; ask.v*=(1+rAsk);

      ov.v+=toOv; ov.basis+=toOv; ov.v*=(1+rTax);
      all.v+=contrib; all.basis+=contrib; all.v*=(1+rTax);

      if(mi===11){
        const lastYear = (y===P.horizon-1);
        // ASK lager tax (withdrawn from the account)
        const gain=ask.v-ask.yStart-ask.contribYr;
        let tg=gain-ask.carry, lager=0;
        if(tg>0){ lager=tg*P.askTax; ask.carry=0; } else { ask.carry=-tg; }
        ask.v-=lager; ask.taxCum+=lager; ask.taxLast=lager;

        // strategy A overflow: dividend -> fund ASK shortfall from overflow -> harvest
        let usedA=P.threshUsed;
        usedA+=divEvent(ov, usedA);
        // contributions fill the ASK first; only the part they couldn't cover is funded by
        // selling from the overflow, so the ASK is kept full without ever selling in the
        // high-contribution case (where fresh money already does the job).
        const shortfall=Math.max(0, budget);
        if(P.redeposit && shortfall>1 && ov.v>1){
          const sell=Math.min(shortfall, ov.v);
          const rg=sell*(Math.max(0,ov.v-ov.basis)/ov.v);
          const rt=bracketTax(rg,thrY,usedA,P.taxLow,P.taxHigh); usedA+=rg;
          const fee=Math.max(P.feePct*sell, P.feeMin);
          ov.basis-=sell*(ov.basis/ov.v); ov.v-=sell;
          ov.taxCum+=rt; ov.feeCum+=fee;
          // re-deposit net proceeds; the deposit pays forex like any other, and the
          // forex cost is deductible in next year's lager base (carried as a loss)
          const net=sell-rt-fee, netAsk=net*(1-P.askForex);
          ask.v+=netAsk; ask.carry+=net-netAsk;
        }
        if(!lastYear) usedA+=harvest(ov, usedA);   // harvesting in the sale year is pure kurtage

        // strategy B: dividend -> harvest
        let usedB=P.threshUsed;
        usedB+=divEvent(all, usedB);
        if(!lastYear) usedB+=harvest(all, usedB);

        // after-tax-if-sold-this-year, using the chosen drawdown strategy
        const askFee = ask.v>1 ? Math.max(P.feePct*ask.v, P.feeMin) : 0;
        const askLiq = Math.max(0, ask.v-askFee)*(1-P.askForex);
        const dOv=drawdown(ov.v, ov.basis, P, thrY, usedA);
        const dAll=drawdown(all.v, all.basis, P, thrY, usedB);
        series.push({year:y+1, A:askLiq+dOv.after, B:dAll.after, ask:askLiq, overflow:dOv.after,
                     defl:Math.pow(1+P.infl, y+1),
                     askFee, dOv, dAll});
      }
    }
    const contributed=P.initial+P.monthly*months;
    const last=series[series.length-1];
    return {
      series, firstOverflow, contributed,
      A_after: last.A, B_after: last.B,
      askFinal: last.ask, overflowFinal: last.overflow,
      A_tax: ask.taxCum + ov.taxCum + last.dOv.tax,
      B_tax: all.taxCum + last.dAll.tax,
      A_fee: ov.feeCum + last.dOv.fee + last.askFee,
      B_fee: all.feeCum + last.dAll.fee,
      A_years: last.dOv.years, B_years: last.dAll.years,
      deflate: Math.pow(1+P.infl, P.horizon)
    };
  }

  return { aktieTax, bracketTax, drawdown, simulate };
});

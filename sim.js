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

  // In married mode each spouse holds their own ASK, so every ASK trade is
  // really two half-size orders and a binding minimum commission is paid twice:
  // 2*max(pct*x/2, min) = max(pct*x, 2*min).
  function askFee(x, P){ return Math.max(P.askFeePct*x, P.askFeeMin*(P.married?2:1)); }

  // One bucket's share income for one tax year. The assessment is annual, so
  // dividends and realised gains/losses net against each other (and against the
  // loss carryforward) regardless of order within the year — a loss realised in
  // December refunds tax already charged on the spring dividends. `base` is
  // band consumed by share income outside the model (P.threshUsed); `carry` is
  // the carried-forward loss, which only ever meets share income here
  // (kildeartsbegrænset, ABL § 13 A).
  function newLedger(thr, base, carry){ return {thr, base, carry, income:0, tax:0}; }
  // the tax a signed income item `d` would add (negative = refund), unbooked
  function taxOn(L, d, P){
    return bracketTax(L.income+d-L.carry, L.thr, L.base, P.taxLow, P.taxHigh)-L.tax;
  }
  // book a signed income item and return its tax delta
  function settle(L, d, P){
    const t=taxOn(L, d, P);
    L.income+=d; L.tax+=t;
    return t;
  }
  // the carry a fresh year would start with: consumed carry is spent, the
  // year's unusable negative income is added (does not mutate L)
  function closeYear(L){
    return L.carry - Math.min(Math.max(0,L.income), L.carry) + Math.max(0,-L.income);
  }

  // sell enough of an average-cost position that the seller nets `target` after
  // realisation tax and commission (grossed up; capped at the position's value).
  // The sale commission reduces the disposal sum before the gain is taxed, as
  // in the actual assessment; rg is that post-fee taxable amount — signed, so a
  // sale below basis realises a loss (tax against L can then be a refund).
  // Prices against the year ledger L without booking; the caller settles rg.
  // Fixed-point iteration — the tax+fee fraction is well below 1, so it contracts.
  function sellForNet(a, target, L, P){
    const gainFrac = a.v>0 ? (a.v-a.basis)/a.v : 0;
    let gross=target;
    for(let i=0;i<8;i++){
      const fee=Math.max(P.feePct*gross, P.feeMin);
      const tax=taxOn(L, gross*gainFrac-fee, P);
      gross=Math.min(a.v, Math.max(0, target+tax+fee));
    }
    const fee=Math.max(P.feePct*gross, P.feeMin);
    const rg=gross*gainFrac-fee;
    const tax=taxOn(L, rg, P);
    return {gross, rg, tax, fee, net: gross-tax-fee};
  }

  // Final drawdown of a realisation position, simulated year by year: what is
  // not yet sold stays invested at gross-TER and keeps distributing, and each
  // year's dividends, gains and losses are netted annually against that year's
  // band and the loss carryforward. Unlike in the accumulation years, cash
  // distributions are paid out — a seller living off the depot would not
  // repurchase with them — and count toward the year's net withdrawal (same
  // tax either way; technical distributions still pay out nothing).
  // thrOf(k) = the progression threshold k years after the first sale year;
  // L0 = the bucket's ledger for the first sale year (the caller's year
  // state, so a first-year loss refunds tax already charged on that year's
  // dividends/refill) — cloned, never mutated; P.threshUsed consumes band in
  // every later year too.
  // Kink windows are capped at 30 years: what the band hasn't absorbed by then
  // is force-sold (partly at the high rate) and flagged via `forced`. In kink
  // mode this function runs strategy B's exit, whose payout path strategy A
  // then replicates (see matchedDrawdown).
  // Returns nominal totals plus the per-year net withdrawals (wd) so the
  // caller can deflate each one by its own payout year. Each wd entry also
  // carries the year's audit trail — gross sale, distribution, tax (signed;
  // negative = refund), fee, the ledger's booked share income against the
  // year's threshold, and the end-of-year value/basis — for the page's
  // year-by-year table.
  function drawdown(value, basis, P, thrOf, L0){
    const out={tax:0, fee:0, years:0, after:0, wd:[], forced:false};
    if(value<=1){ out.after=Math.max(0,value); return out; }
    const r=Math.max(-0.99, P.gross-P.taxTer);
    const MAXY=30;
    const N=P.drawMode==='kink' ? MAXY : Math.min(100, Math.max(1, Math.round(P.liqYears)));
    let v=value, b=basis;
    let L=Object.assign({}, L0, {thr:thrOf(0)});
    for(let k=0; k<100; k++){
      let divNet=0, yDiv=0, yTax=0, yFee=0, ySold=0;
      if(k>0){
        L=newLedger(thrOf(k), P.threshUsed, closeYear(L));
        // distributions accrue to the holdings at the start of the year
        const divBase=v;
        v*=(1+r);
        const div=P.taxDiv*divBase;
        if(div>0){
          const dt=settle(L, div, P);
          if(P.divMode==='tech'){ b+=div; b-=dt*(b/v); v-=dt; }
          else { v-=div; divNet=div-dt; }   // paid out, not reinvested
          out.tax+=dt; yDiv=div; yTax+=dt;
        }
      }
      const gain=v-b;
      let sell;
      if(P.drawMode==='kink'){
        // sell just enough gain to fill the year's remaining low band — carried
        // losses and negative income so far absorb tax-free on top of it (the
        // sale fee shaves the taxable gain, so the fill runs a commission short —
        // second-order); the final window year force-sells whatever the band
        // hasn't absorbed
        const band=Math.max(0, (L.thr-L.base)-(L.income-L.carry));
        if(k>=N-1){ sell=v; if(gain>band) out.forced=true; }
        else sell = gain<=band ? v : Math.min(v, band*v/gain);
      } else {
        sell = k>=N-1 ? v : v/(N-k);
      }
      let net=divNet;
      out.after+=divNet;
      if(sell>0.01){
        const fee=Math.max(P.feePct*sell, P.feeMin);
        const rg=sell*gain/v-fee;      // signed: selling below basis realises a loss
        const tax=settle(L, rg, P);    // negative = same-year refund
        const saleNet=Math.max(0, sell-tax-fee);
        net+=saleNet;
        b-=sell*(b/v); v-=sell;
        out.tax+=tax; out.fee+=fee; out.after+=saleNet;
        ySold=sell; yTax+=tax; yFee=fee;
      }
      // abort = what the remainder would net, sold as a lump against the next
      // year's fresh band and carry (approximate; feeds the chart's wealth line)
      let abort=Math.max(0, v);
      if(v>1){
        const af=Math.max(P.feePct*v, P.feeMin);
        abort=Math.max(0, v - bracketTax((v-b)-af-closeYear(L), thrOf(k+1), P.threshUsed, P.taxLow, P.taxHigh) - af);
      }
      out.wd.push({net, k, abort, sold:ySold, div:yDiv, tax:yTax, fee:yFee,
                   income:L.income, thr:L.thr, v:Math.max(0,v), basis:Math.max(0,b)});
      out.years=k+1;
      if(v<=1) break;
    }
    return out;
  }

  // Even drawdown of the ASK over N years ('fixed years' mode — kink mode uses
  // matchedDrawdown instead): the account stays invested and mark-to-market
  // taxed until sold; each sale pays ASK commission and FX. Both are paid
  // inside the account and thus remain deductible via the loss carryforward —
  // which lapses when the account closes in the final year.
  function askDrawdown(value, carry, P, N){
    const out={tax:0, fee:0, fx:0, years:0, after:0, wd:[]};
    if(value<=1){ out.after=Math.max(0,value); return out; }
    let v=value;
    for(let k=0; k<N && v>1; k++){
      let yTax=0;
      if(k>0){
        const yStart=v;
        v*=(1+Math.max(-0.99, P.gross-P.askTer));
        let tg=v-yStart-carry, tax=0;
        if(tg>0){ tax=tg*P.askTax; carry=0; } else carry=-tg;
        v-=tax; out.tax+=tax; yTax=tax;
      }
      const sell = k>=N-1 ? v : v/(N-k);
      const fee=askFee(sell, P);
      const fx=Math.max(0, sell-fee)*P.askForex;
      const net=Math.max(0, sell-fee-fx);
      carry+=sell-net;   // costs paid inside the account stay deductible
      v-=sell;
      const abort = v>1
        ? Math.max(0, (v-askFee(v, P))*(1-P.askForex))
        : Math.max(0, v);
      out.fee+=fee; out.fx+=fx; out.after+=net;
      out.wd.push({net, k, abort, sold:sell, tax:yTax, fee, fx, v:Math.max(0,v), carry});
      out.years=k+1;
    }
    return out;
  }

  // Kink-mode drawdown of strategy A, matched to strategy B's payout path
  // (ref = B's band-fill drawdown): A delivers exactly the same net cash in
  // the same years, so the strategies differ only in what stays invested —
  // their totals then compare fairly no matter what the saver does with the
  // withdrawals. The overflow depot's own cash distributions (paid out, as in
  // drawdown) count toward the year's target first; band-limited sales cover
  // the next slice (realising above the kink early would pay 42 % now instead
  // of 42 % at the forced final sale, losing pure deferral); the ASK — which
  // has no kink to respect and is the lowest-taxed wrapper — covers the rest.
  // The depot's distributions can never overshoot the target: it is worth at
  // most as much as B's depot, so its dividends are at most B's, which B pays
  // out too. The final window year liquidates both buckets, flagging `forced`
  // if the depot's remaining gain overflows the band.
  function matchedDrawdown(ovV, ovBasis, askV, askCarry, P, thrOf, L0, ref){
    const N=Math.max(1, ref.years||1);
    const oOv={tax:0, fee:0, years:0, after:0, wd:[], forced:false};
    const oAsk={tax:0, fee:0, fx:0, years:0, after:0, wd:[]};
    let v=ovV, b=ovBasis, av=askV, carry=askCarry;
    let L=Object.assign({}, L0, {thr:thrOf(0)});
    const r=Math.max(-0.99, P.gross-P.taxTer);
    for(let k=0;k<N;k++){
      let divNet=0;
      let yOvDiv=0, yOvTax=0, yOvFee=0, yOvSold=0, yAskTax=0, yAskFee=0, yAskFx=0, yAskSold=0;
      if(k>0){
        // same yearly bookkeeping as drawdown (depot) and askDrawdown (ASK)
        L=newLedger(thrOf(k), P.threshUsed, closeYear(L));
        if(v>0){
          const divBase=v;
          v*=(1+r);
          const div=P.taxDiv*divBase;
          if(div>0){
            const dt=settle(L, div, P);
            if(P.divMode==='tech'){ b+=div; b-=dt*(b/v); v-=dt; }
            else { v-=div; divNet=div-dt; }   // paid out, not reinvested
            oOv.tax+=dt; yOvDiv=div; yOvTax+=dt;
          }
        }
        if(av>1){
          const yStart=av;
          av*=(1+Math.max(-0.99, P.gross-P.askTer));
          let tg=av-yStart-carry, tax=0;
          if(tg>0){ tax=tg*P.askTax; carry=0; } else carry=-tg;
          av-=tax; oAsk.tax+=tax; yAskTax=tax;
        }
      }
      let netOv=divNet, netAsk=0;
      oOv.after+=divNet;
      const gain=v-b;
      const band=Math.max(0, (L.thr-L.base)-(L.income-L.carry));
      if(k>=N-1){
        if(v>1){
          const fee=Math.max(P.feePct*v, P.feeMin);
          const rg=gain-fee;
          const tax=settle(L, rg, P);
          const saleNet=Math.max(0, v-tax-fee);
          netOv+=saleNet;
          if(gain>band) oOv.forced=true;
          oOv.tax+=tax; oOv.fee+=fee; oOv.after+=saleNet;
          yOvSold=v; yOvTax+=tax; yOvFee=fee;
          v=0; b=0;
        }
        if(av>1){
          const fee=askFee(av, P);
          const fx=Math.max(0, av-fee)*P.askForex;
          netAsk=Math.max(0, av-fee-fx);
          oAsk.fee+=fee; oAsk.fx+=fx; oAsk.after+=netAsk;
          yAskSold=av; yAskFee=fee; yAskFx=fx;
          av=0;
        }
      } else {
        const target=(ref.wd[k]||{net:0}).net;
        const need=target-netOv;
        if(need>0.01){
          if(v>1){
            // gross up for the still-missing net, then cap at the band-filling sale
            const bandSell = gain<=band ? v : Math.min(v, band*v/gain);
            const s=sellForNet({v, basis:b}, Math.min(need, v), L, P);
            const gross=Math.min(s.gross, bandSell);
            if(gross>0.01){
              const fee=Math.max(P.feePct*gross, P.feeMin);
              const rg=gross*(gain/v)-fee;
              const tax=settle(L, rg, P);
              const saleNet=Math.max(0, gross-tax-fee);
              netOv+=saleNet;
              b-=gross*(b/v); v-=gross;
              oOv.tax+=tax; oOv.fee+=fee; oOv.after+=saleNet;
              yOvSold=gross; yOvTax+=tax; yOvFee=fee;
            }
          }
          const short=target-netOv;
          if(short>0.01 && av>1){
            // gross up the ASK top-up: net = (g - fee)*(1 - fx); the fee
            // depends on g through the minimum, so iterate like sellForNet
            let g=short;
            for(let i=0;i<6;i++){ const fee=askFee(g,P); g=Math.min(av, short/(1-P.askForex)+fee); }
            const fee=askFee(g,P);
            const fx=Math.max(0,g-fee)*P.askForex;
            netAsk=Math.max(0, g-fee-fx);
            carry+=g-netAsk;   // costs paid inside the account stay deductible
            av-=g;
            oAsk.fee+=fee; oAsk.fx+=fx; oAsk.after+=netAsk;
            yAskSold=g; yAskFee=fee; yAskFx=fx;
          }
        }
      }
      // aborts = what each remainder would net sold as a lump next year
      // (same approximations as drawdown/askDrawdown; feeds the wealth line)
      let abortOv=Math.max(0,v);
      if(v>1){
        const af=Math.max(P.feePct*v, P.feeMin);
        abortOv=Math.max(0, v - bracketTax((v-b)-af-closeYear(L), thrOf(k+1), P.threshUsed, P.taxLow, P.taxHigh) - af);
      }
      const abortAsk = av>1 ? Math.max(0,(av-askFee(av,P))*(1-P.askForex)) : Math.max(0,av);
      oOv.wd.push({net:netOv, k, abort:abortOv, sold:yOvSold, div:yOvDiv, tax:yOvTax, fee:yOvFee,
                   income:L.income, thr:L.thr, v:Math.max(0,v), basis:Math.max(0,b)});
      oAsk.wd.push({net:netAsk, k, abort:abortAsk, sold:yAskSold, tax:yAskTax, fee:yAskFee, fx:yAskFx,
                    v:Math.max(0,av), carry});
      oOv.years=k+1; oAsk.years=k+1;
    }
    return {dOv:oOv, dAsk:oAsk};
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
    let ov ={v:0,basis:0,divBase:0,led:null,taxCum:0,feeCum:0};   // overflow taxable (strategy A)
    let all={v:0,basis:0,divBase:0,led:null,taxCum:0,feeCum:0};   // all taxable (strategy B)
    let budget=0, firstOverflow=null, fin=null;
    // year-start snapshot of the cumulative counters, so each chart point can
    // report the year's own contributions, taxes and fees (the audit table)
    let snap=null;
    const series=[];
    // the chart's curves show wealth if everything were sold within the given
    // year (one lump per bucket); P1 prices that instant exit
    const P1=Object.assign({}, P, {drawMode:'years', liqYears:1});

    // realise gain up to the remaining low-rate band, then buy back (steps up
    // basis). Carried losses and negative income so far absorb tax-free on top
    // of the band, so a carry lets the harvest step up more.
    function harvest(a, L){
      if(!P.harvest) return;
      const gain=Math.max(0, a.v-a.basis);
      const g=Math.min(Math.max(0, (L.thr-L.base)-(L.income-L.carry)), gain);
      if(g<=1) return;
      const notional=g/(gain/a.v);                  // shares sold to realise g
      const sellFee=Math.max(P.feePct*notional, P.feeMin);
      const tg=g-sellFee;                           // selling costs reduce the disposal sum
      const tax=settle(L, tg, P);                   // fills the band: low rate or carry
      const buyFee=Math.max(P.feePct*(notional-sellFee-tax), P.feeMin);
      // the buy fee is capitalised into the new acquisition cost, so the basis
      // ends exactly one buy fee above the rebought value
      a.v-=(tax+sellFee+buyFee); a.basis+=(g-sellFee-tax);
      a.taxCum+=tax; a.feeCum+=sellFee+buyFee;
    }

    // the year's distribution/minimumsindkomst, taxed as share income and based
    // on the holdings at the start of the year (a.divBase — the funds' ex-dates
    // are Feb-Apr, so later purchases only join next year). 'cash' (SPIIMA/
    // SPVIGAKL): the dividend is paid out, tax is paid from it, and the rest is
    // reinvested — value drops by the tax, cost basis rises by the net amount.
    // 'tech' (STIIAM): nothing is paid out — the cost basis is stepped up by the gross
    // amount, and the tax is funded by selling a sliver of the holding (the gain and
    // trading fee on that tiny sale are ignored as second-order).
    function divEvent(a, L){
      const div=P.taxDiv*a.divBase;
      if(div<=0 || a.v<=0) return;
      const dt=settle(L, div, P);
      if(P.divMode==='tech'){ a.basis+=div; a.basis-=dt*(a.basis/a.v); a.v-=dt; }
      else { a.v-=dt; a.basis+=div-dt; }
      a.taxCum+=dt;
    }

    // sell grossed-up from the overflow depot and deposit the net into the ASK,
    // so the deposited cash equals the intended amount; the ASK-side buy pays
    // ASK commission and FX, both implicitly deductible (deposits count gross
    // in the mark-to-market base).
    function fundAsk(target, L){
      const s=sellForNet(ov, Math.min(target, ov.v), L, P);
      if(s.net<=1) return null;
      settle(L, s.rg, P);
      ov.basis-=s.gross*(ov.basis/ov.v); ov.v-=s.gross;
      ov.taxCum+=s.tax; ov.feeCum+=s.fee;
      const fee=askFee(s.net, P);
      const netAsk=(s.net-fee)*(1-P.askForex);
      ask.v+=netAsk; ask.feeCum+=fee; ask.fxCum+=(s.net-fee)*P.askForex;
      budget-=s.net;
      return {deposited:s.net, netAsk};
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
        snap={contribAsk:0, contribOv:0, refill:0,
              askFee:ask.feeCum, askFx:ask.fxCum,
              ovTax:ov.taxCum, ovFee:ov.feeCum, allTax:all.taxCum, allFee:all.feeCum};
        // fresh share-income year; unused losses carry forward
        ov.led=newLedger(thrY, P.threshUsed, ov.led?closeYear(ov.led):0);
        all.led=newLedger(thrY, P.threshUsed, all.led?closeYear(all.led):0);
      }
      const contrib=P.monthly+(m===0?P.initial:0);
      let toAsk=Math.min(budget,contrib); budget-=toAsk;
      let toOv=contrib-toAsk;
      if(toOv>1 && firstOverflow===null) firstOverflow=y+1;
      snap.contribAsk+=toAsk; snap.contribOv+=toOv;

      // buy-side kurtage: recurring buys through månedsopsparing (P.msAsk/P.msDepot)
      // are commission-free; without it every buy pays the normal trading fee —
      // the ASK schedule for ASK buys, the depot schedule for depot buys.
      // Purchase fees join the cost basis in the taxable account (as in the actual
      // assessment), so basis counts the gross amount while value receives net.
      // ASK deposits also count gross in the mark-to-market base, which makes both
      // the buy fee and the FX cost implicitly deductible there.
      const buyFeeAsk=(!P.msAsk && toAsk>0) ? askFee(toAsk, P) : 0;
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
          const f=fundAsk(target, ov.led);
          if(f){ ask.contribYr+=f.deposited; snap.refill+=f.deposited; }
        }
        // dividend entitlement snapshot (after the January contribution/refill)
        ov.divBase=ov.v; all.divBase=all.v;
      }

      ask.v*=(1+rAsk); ov.v*=(1+rTax); all.v*=(1+rTax);

      if(mi===11){
        const lastYear = (y===P.horizon-1);
        // strategy A overflow: dividend -> December catch-all refill for
        // allowance the January refill and the year's contributions didn't
        // cover (e.g. the depot ran dry in January); deposited before year-end,
        // so it counts in this year's § 13 base and its buy costs reduce the gain
        divEvent(ov, ov.led);
        const shortfall=Math.max(0, budget);
        if(P.redeposit && shortfall>1 && ov.v>1){
          const f=fundAsk(shortfall, ov.led);
          if(f){ ask.contribYr+=f.deposited; snap.refill+=f.deposited; }
        }

        // ASK mark-to-market tax (withdrawn from the account)
        const gain=ask.v-ask.yStart-ask.contribYr;
        let tg=gain-ask.carry, lagerTax=0;
        if(tg>0){ lagerTax=tg*P.askTax; ask.carry=0; } else { ask.carry=-tg; }
        ask.v-=lagerTax; ask.taxCum+=lagerTax; ask.taxLast=lagerTax;

        if(!lastYear) harvest(ov, ov.led);   // harvesting in the sale year only adds fees

        // strategy B: dividend -> harvest
        divEvent(all, all.led);
        if(!lastYear) harvest(all, all.led);

        // chart point: after-tax wealth if everything were sold this year
        const thrOf=k=>thrAt(y+k);
        const dOv1=drawdown(ov.v, ov.basis, P1, thrOf, ov.led);
        const dAll1=drawdown(all.v, all.basis, P1, thrOf, all.led);
        const dAsk1=askDrawdown(ask.v, ask.carry, P, 1);
        const deflY=Math.pow(1+P.infl, y+1);
        series.push({year:y+1,
          A:dAsk1.after+dOv1.after, B:dAll1.after,
          Areal:(dAsk1.after+dOv1.after)/deflY, Breal:dAll1.after/deflY,
          ask:dAsk1.after, askReal:dAsk1.after/deflY,
          // realisation tax the instant sale would trigger (the tooltip's
          // "latent tax" line; the ASK has none — its gains are already taxed)
          latB:dAll1.tax, latBreal:dAll1.tax/deflY,
          // the year's own audit trail: flows, 31 Dec balances, this year's
          // taxes/fees/carry per bucket — all nominal, household totals
          detail:{
            contribAsk:snap.contribAsk, contribOv:snap.contribOv, refill:snap.refill,
            thr:thrY,
            askV:ask.v, askTax:lagerTax, askCarry:ask.carry,
            askFee:ask.feeCum-snap.askFee, askFx:ask.fxCum-snap.askFx,
            ovV:ov.v, ovBasis:ov.basis, ovIncome:ov.led.income,
            ovTax:ov.taxCum-snap.ovTax, ovFee:ov.feeCum-snap.ovFee, ovCarry:closeYear(ov.led),
            allV:all.v, allBasis:all.basis, allIncome:all.led.income,
            allTax:all.taxCum-snap.allTax, allFee:all.feeCum-snap.allFee, allCarry:closeYear(all.led)
          }});

        if(lastYear){
          // the chosen strategy, simulated once from the horizon (the headline
          // numbers and the chart's drawdown wedge). In kink mode strategy B's
          // band-limited exit (capped at 30 years) defines the payout path and
          // strategy A matches it krone for krone, so the two totals compare
          // at identical cash flows.
          const dAll=drawdown(all.v, all.basis, P, thrOf, all.led);
          let dOv, dAsk;
          if(P.drawMode==='kink'){
            const m=matchedDrawdown(ov.v, ov.basis, ask.v, ask.carry, P, thrOf, ov.led, dAll);
            dOv=m.dOv; dAsk=m.dAsk;
          } else {
            dOv=drawdown(ov.v, ov.basis, P, thrOf, ov.led);
            dAsk=askDrawdown(ask.v, ask.carry, P, Math.min(100, Math.max(1,Math.round(P.liqYears))));
          }
          // real mode deflates each payout by its own year
          const realSum=w=>w.reduce((s,x)=>s+x.net/Math.pow(1+P.infl, y+1+x.k),0);
          fin={dOv, dAll, dAsk,
               A:dAsk.after+dOv.after, B:dAll.after,
               Areal:realSum(dAsk.wd)+realSum(dOv.wd), Breal:realSum(dAll.wd)};
        }
      }
    }
    const contributed=P.initial+P.monthly*months;
    // the chosen plan's payout path, year by year, for the chart's drawdown
    // wedge: cumulative net cash received, and the wealth along the way —
    // cash plus what the remainder would net if sold at once. The wealth path
    // starts where the instant-sale curve ends and climbs to the plan's total,
    // making the growth during the sale years visible. Real amounts deflate
    // each payout by its own year.
    const wdAt=(d,k)=>d.wd[k]||{net:0,abort:0};
    const dLen=Math.max(fin.dAsk.wd.length, fin.dOv.wd.length, fin.dAll.wd.length);
    const deflD=k=>Math.pow(1+P.infl, P.horizon+k);
    const drawSeries=[];
    for(let k=0,cA=0,cB=0,cAr=0,cBr=0;k<dLen;k++){
      const a1=wdAt(fin.dAsk,k), a2=wdAt(fin.dOv,k), b=wdAt(fin.dAll,k);
      cA+=a1.net+a2.net; cB+=b.net;
      cAr+=(a1.net+a2.net)/deflD(k); cBr+=b.net/deflD(k);
      const abA=a1.abort+a2.abort, abB=b.abort;
      drawSeries.push({k,
        cashA:cA, wealthA:cA+abA, cashB:cB, wealthB:cB+abB,
        cashAreal:cAr, wealthAreal:cAr+abA/deflD(k),
        cashBreal:cBr, wealthBreal:cBr+abB/deflD(k)});
    }
    return {
      series, firstOverflow, contributed, drawSeries,
      // the chosen plan's raw per-year drawdowns, for the audit table
      plan:{dOv:fin.dOv, dAsk:fin.dAsk, dAll:fin.dAll},
      A_after: fin.A, B_after: fin.B,
      A_real: fin.Areal, B_real: fin.Breal,
      askFinal: fin.dAsk.after, overflowFinal: fin.dOv.after,
      A_tax: ask.taxCum + ov.taxCum + fin.dOv.tax + fin.dAsk.tax,
      B_tax: all.taxCum + fin.dAll.tax,
      A_fee: ask.feeCum + ov.feeCum + fin.dOv.fee + fin.dAsk.fee,
      B_fee: all.feeCum + fin.dAll.fee,
      A_fx: ask.fxCum + fin.dAsk.fx,
      A_years: fin.dOv.years, B_years: fin.dAll.years,
      A_forced: fin.dOv.forced, B_forced: fin.dAll.forced
    };
  }

  return { aktieTax, bracketTax, sellForNet, drawdown, askDrawdown, matchedDrawdown, simulate };
});

/* Historical public fee-table transcription. UNVERIFIED, not current mandatory prices.
 * Only annual financial-statement audit is represented. See RULES.md for limitations.
 */
globalThis.REGION_REFERENCE=[
  {id:'gx',name:'广西',document:'桂价费〔2012〕74号',status:'unverified_historical',sourceUrl:'https://xycost.com/archives/402807',version:'2012 · 转录待核',basis:'max',mode:'flat',minimumYuan:0,fixedYuan:null,
    tiers:[{upToYuan:500000,feeYuan:1500},{upToYuan:1000000,feeYuan:3000},{upToYuan:5000000,feeYuan:6000},{upToYuan:10000000,feeYuan:10000},{upToYuan:50000000,feeYuan:15000},{upToYuan:100000000,feeYuan:25000},{upToYuan:200000000,feeYuan:30000}],
    notes:'来自历史文件第三方转录，尚未核对政府原件。按资产总额、营业收入孰高演示，采用分档一次计费。原表“51/101万元”等边界暂解释为超过上一档，不作整万元取整；此解释待复核。2亿元以上的比例档暂未录入，须人工报价；零规模及集团合并等特殊情况另行审核。'},
  {id:'hb',name:'河北',document:'冀价经费〔2012〕18号',status:'unverified_historical',sourceUrl:'https://xycost.com/archives/401544',version:'2012 · 转录待核',basis:'assets',mode:'progressive',minimumYuan:0,fixedYuan:null,
    tiers:[{upToYuan:500000,feeYuan:2000},{upToYuan:1000000,ratePerMille:2},{upToYuan:5000000,ratePerMille:0.9},{upToYuan:10000000,ratePerMille:0.7},{upToYuan:50000000,ratePerMille:0.5},{upToYuan:100000000,ratePerMille:0.3},{upToYuan:500000000,ratePerMille:0.15},{upToYuan:1000000000,ratePerMille:0.1},{upToYuan:null,ratePerMille:0.08}],
    notes:'来自历史文件第三方转录，尚未核对政府原件。首档50万元以内固定2000元，其后按各段“部分”费率累加。默认资产总额；以知识产权、无形资产为主要资产的单位需在规则页将基数改为营业收入。未自动套用非营利组织或证券业务调整。'},
  {id:'sh',name:'上海',document:'本所自定义工时预算',status:'custom_unverified',sourceUrl:'https://czj.sh.gov.cn/zys_8908/zcfg_8983/zcfb_8985/hj_9035/hjssws_9041/20110201/0017-157508.html',version:'本所演示 v0.1',basis:'assets',mode:'budget',minimumYuan:0,fixedYuan:null,tiers:[],notes:'上海官方文件明确市场调节价，不提供统一费率表。本列默认引用本所示例工时预算，可改为事务所自定义规则。演示人员费率不是上海行业参考价。'}
];

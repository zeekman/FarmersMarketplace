/**
 * Translations for wallet and dashboard components
 * To be integrated into en.json, sw.json, and ar.json
 * This is a reference file showing the structured translations
 */

export const walletTranslations = {
  alerts: {
    title: { en: "Activity Alerts", sw: "Arifa za Shughuli", ar: "تنبيهات النشاط" },
    noAlerts: { en: "No alerts yet.", sw: "Hakuna arifa bado.", ar: "لا توجد تنبيهات حتى الآن." },
    markRead: { en: "Mark read", sw: "Weka kama imesomwa", ar: "وضع علامة كمقروء" },
    largePayment: { en: "Large Payment", sw: "Malipo Makubwa", ar: "دفع كبير" },
    failedTransactions: { en: "Failed Transactions", sw: "Miamala Iliyoshindwa", ar: "معاملات فاشلة" },
  },
  budget: {
    title: { en: "Monthly Budget", sw: "Bajeti ya Kila Mwezi", ar: "الميزانية الشهرية" },
    limitLabel: { en: "Budget limit (XLM)", sw: "Kikomo cha bajeti (XLM)", ar: "حد الميزانية (XLM)" },
    optional: { en: "Optional", sw: "Hiari", ar: "اختياري" },
    saveBtn: { en: "Save", sw: "Hifadhi", ar: "حفظ" },
    spent: { en: "Spent: {{spent}} / {{limit}} XLM", sw: "Iliyotumika: {{spent}} / {{limit}} XLM", ar: "المبالغ المنفقة: {{spent}} / {{limit}} XLM" },
    remaining: { en: "Remaining: {{amount}} XLM", sw: "Iliyobaki: {{amount}} XLM", ar: "المتبقي: {{amount}} XLM" },
    warning: { en: "Warning: you have used {{percent}}% of your monthly budget.", sw: "Onyo: umechotumika {{percent}}% ya bajeti yako ya kila mwezi.", ar: "تحذير: لقد استخدمت {{percent}}% من ميزانيتك الشهرية." },
    insufficient: { en: "Insufficient balance. You have {{available}} XLM available.", sw: "Salio halitoshi. Una {{available}} XLM zinazopatikana.", ar: "رصيد غير كافي. لديك {{available}} XLM متاحة." },
  },
  claimable: {
    title: { en: "Pending Claims", sw: "Madai Yanayosubiri", ar: "المطالبات المعلقة" },
    description: { en: "Funds locked in Stellar claimable balances (e.g. pre-order refunds) waiting to be claimed.", sw: "Fedha zilizofungwa kwenye Stellar claimable balances (mf. malipo ya kumrejea kwa pre-order) zikisubiri kudaiwa.", ar: "الأموال المقفلة في أرصدة Stellar القابلة للمطالبة (مثل استرجاع الطلبات المسبقة) في انتظار المطالبة." },
    loading: { en: "Loading...", sw: "Inapakia...", ar: "جاري التحميل..." },
    idLabel: { en: "ID:", sw: "Kitambulisho:", ar: "معرّف:" },
    condition: { en: "Condition", sw: "Sharti", ar: "الشرط" },
    claimable: { en: "Claimable {{when}}", sw: "Inaweza kudaiwa {{when}}", ar: "قابل للمطالبة {{when}}" },
    claimableNow: { en: "Claimable now", sw: "Inaweza kudaiwa sasa", ar: "قابل للمطالبة الآن" },
    claimableAfter: { en: "Claimable after {{date}}", sw: "Inaweza kudaiwa baada ya {{date}}", ar: "قابل للمطالبة بعد {{date}}" },
    claimableAfterDays: { en: "Claimable after ~{{days}} day{{plural}}", sw: "Inaweza kudaiwa baada ya takriban siku {{days}}", ar: "قابل للمطالبة بعد حوالي {{days}} يوم" },
    claimableUntil: { en: "Claimable until {{date}}", sw: "Inaweza kudaiwa hadi {{date}}", ar: "قابل للمطالبة حتى {{date}}" },
    claim: { en: "Claim", sw: "Dai", ar: "المطالبة" },
    claiming: { en: "Claiming…", sw: "Inadaia…", ar: "جاري المطالبة…" },
  },
};

export const dashboardTranslations = {
  orderStatus: {
    pending: { en: "Pending", sw: "Inasubiri", ar: "قيد الانتظار" },
    paid: { en: "Paid", sw: "Imelipwa", ar: "مدفوع" },
    processing: { en: "Processing", sw: "Inashughulikia", ar: "قيد المعالجة" },
    shipped: { en: "Shipped", sw: "Imesafirishwa", ar: "تم الشحن" },
    delivered: { en: "Delivered", sw: "Imewasilishwa", ar: "تم التسليم" },
    cancelled: { en: "Cancelled", sw: "Imefutwa", ar: "ملغى" },
    refunded: { en: "Refunded", sw: "Iliyodaiwa", ar: "استرجاع" },
  },
  coupons: {
    title: { en: "Coupon Codes", sw: "Codes za Kuponi", ar: "رموز القسيمة" },
    codeLabel: { en: "Code", sw: "Nambari", ar: "الكود" },
    codePh: { en: "e.g. SUMMER10", sw: "mf. SUMMER10", ar: "مثال SUMMER10" },
    typeLabel: { en: "Type", sw: "Aina", ar: "النوع" },
    typePercent: { en: "Percent (%)", sw: "Asilimia (%)", ar: "نسبة مئوية (%)" },
    typeFixed: { en: "Fixed (XLM)", sw: "Imebatilishwa (XLM)", ar: "ثابتة (XLM)" },
    valueLabel: { en: "Value", sw: "Thamani", ar: "القيمة" },
    maxUsesLabel: { en: "Max uses", sw: "Upeo wa matumizi", ar: "الاستخدام الأقصى" },
    maxUsesOptional: { en: "(optional)", sw: "(hiari)", ar: "(اختياري)" },
    maxUsesPh: { en: "Unlimited", sw: "Bila Kikomo", ar: "غير محدود" },
    expiresLabel: { en: "Expires at", sw: "Inaisha", ar: "ينتهي في" },
    expiresOptional: { en: "(optional)", sw: "(hiari)", ar: "(اختياري)" },
    createBtn: { en: "Create Coupon", sw: "Fungua Kuponi", ar: "إنشاء قسيمة" },
    creating: { en: "Creating…", sw: "Inatengeneza…", ar: "جاري الإنشاء…" },
    created: { en: "Coupon created successfully.", sw: "Kuponi imeundwa kwa mafanikio.", ar: "تم إنشاء القسيمة بنجاح." },
    noCoupons: { en: "No coupon codes yet.", sw: "Hakuna nambari za kuponi bado.", ar: "لا توجد رموز قسيمة حتى الآن." },
    deleted: { en: "Coupon deleted.", sw: "Kuponi imefutwa.", ar: "تم حذف القسيمة." },
  },
  bundleDiscount: {
    title: { en: "Bundle Discounts", sw: "Diskaunti za Paketi", ar: "خصومات الحزم" },
    description: { en: "Buyers who order multiple different products from you get an automatic discount.", sw: "Wanunuzi ambao wanaagiza bidhaa tofauti nyingi kutoka kwa wewe hupata diskaunti otomatikal.", ar: "يحصل المشترون الذين يطلبون منتجات مختلفة متعددة عليك على خصم تلقائي." },
    minProductsLabel: { en: "Min. distinct products", sw: "Min. bidhaa tofauti", ar: "الحد الأدنى للمنتجات المختلفة" },
    minProductsPh: { en: "e.g. 3", sw: "mf. 3", ar: "مثال 3" },
    discountLabel: { en: "Discount %", sw: "Diskaunti %", ar: "الخصم %" },
    discountPh: { en: "e.g. 10", sw: "mf. 10", ar: "مثال 10" },
    addTierBtn: { en: "Add Tier", sw: "Ongeza Kiwango", ar: "إضافة المستوى" },
    updateTierBtn: { en: "Update Tier", sw: "Sasisha Kiwango", ar: "تحديث المستوى" },
    noTiers: { en: "No discount tiers configured.", sw: "Hakuna viwango vya diskaunti vilivyoandaliwa.", ar: "لم يتم تكوين مستويات خصم." },
    editBtn: { en: "Edit", sw: "Hariri", ar: "تحرير" },
    deleteBtn: { en: "Delete", sw: "Futa", ar: "حذف" },
    conflictError: { en: "A tier for {{min}}+ products already exists.", sw: "Kiwango cha {{min}}+ bidhaa tayari kipo.", ar: "يوجد بالفعل مستوى لـ {{min}}+ منتجات." },
  },
  analytics: {
    title: { en: "Analytics", sw: "Uchambuzi", ar: "التحليلات" },
    preset7: { en: "7 d", sw: "Siku 7", ar: "7 أيام" },
    preset30: { en: "30 d", sw: "Siku 30", ar: "30 يوم" },
    preset90: { en: "90 d", sw: "Siku 90", ar: "90 يوم" },
    presetCustom: { en: "Custom", sw: "Maalum", ar: "مخصص" },
    noData: { en: "No sales or views in this period yet", sw: "Hakuna mauzo au mwonekano katika kipindi hiki bado", ar: "لا توجد مبيعات أو مشاهدات في هذه الفترة حتى الآن" },
  },
  multisig: {
    title: { en: "Pending Signature Requests ({{count}})", sw: "Mahitaji ya Sahihi Yanayosubiri ({{count}})", ar: "طلبات التوقيع المعلقة ({{count}})" },
    signBtn: { en: "Sign", sw: "Sahihi", ar: "وقّع" },
    signing: { en: "Signing…", sw: "Inasahihi…", ar: "جاري التوقيع…" },
    submitBtn: { en: "Submit release", sw: "Wasilisha kutolewa", ar: "إرسال الإطلاق" },
  },
};

export default {
  wallet: walletTranslations,
  dashboard: dashboardTranslations,
};

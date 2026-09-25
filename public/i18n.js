// Ebony — English / Amharic (አማርኛ) switch, shared by every screen.
//
// How it works: the screens keep producing English exactly as before;
// this file translates what's shown on screen (text, placeholders,
// tooltips, and confirm/prompt pop-ups) when Amharic is chosen, and puts
// the English back when English is chosen. A MutationObserver keeps up
// with anything the screens render later (tickets, toasts, tables…).
//
// Only the app's own wording is translated. Data typed in by staff —
// menu item names, category names, staff names — shows as entered.
//
// To change a translation, edit the AM dictionary or PATTERNS below.
// The choice is remembered per device (localStorage 'ebony_lang').
(function () {
  'use strict';

  const STORAGE_KEY = 'ebony_lang';

  // ---------------- Exact phrases ----------------
  // Leading/trailing symbols (emoji, arrows, ＋, ✓ …) are kept as they are,
  // so "📷 Take Photo" only needs "Take Photo" here.
  const AM = {
    // Sign-in / general
    'Sign In': 'ግባ',
    'Email': 'ኢሜይል',
    'Password': 'የይለፍ ቃል',
    'Log out': 'ውጣ',
    'Refresh': 'አድስ',
    'Close': 'ዝጋ',
    'Cancel': 'ይቅር',
    'Save': 'አስቀምጥ',
    'Save Changes': 'ለውጦቹን አስቀምጥ',
    'Edit': 'አስተካክል',
    'Delete': 'ሰርዝ',
    'Remove': 'አስወግድ',
    'Rename': 'ስም ቀይር',
    'Retry': 'እንደገና ሞክር',
    'Back': 'ተመለስ',
    'View': 'ተመልከት',
    'All': 'ሁሉም',
    'Other': 'ሌላ',
    'Today': 'ዛሬ',
    'Date': 'ቀን',
    'Day': 'ቀን',
    'Time': 'ሰዓት',
    'Filter by date': 'በቀን አጣራ',
    'Login failed': 'መግባት አልተቻለም',
    'Invalid credentials': 'ኢሜይል ወይም የይለፍ ቃል ትክክል አይደለም',
    'Demo login —': 'የሙከራ መግቢያ —',
    'Demo logins —': 'የሙከራ መግቢያዎች —',
    '(created by': '(የተፈጠረው በ',
    'Notifications': 'ማሳወቂያዎች',
    'Open menu': 'ምናሌ ክፈት',
    'Menu': 'ሜኑ',
    'Processing…': 'በሂደት ላይ…',
    'Sending…': 'በመላክ ላይ…',
    'Saving…': 'በማስቀመጥ ላይ…',
    'Loading…': 'በመጫን ላይ…',
    'Just now': 'አሁን',
    'Unknown': 'ያልታወቀ',
    'Thank you!': 'እናመሰግናለን!',
    'OK': 'ደህና',

    // Screen names (under the Ebony logo) and roles
    'Cashier': 'ገንዘብ ተቀባይ',
    'Kitchen': 'ኩሽና',
    'Bar': 'ባር',
    'Waiter': 'አስተናጋጅ',
    'Manager': 'ሥራ አስኪያጅ',
    'Chef': 'ሼፍ',
    'Barista': 'ባሪስታ',
    // Role labels as stored (shown in the Staff table)
    'MANAGER': 'ሥራ አስኪያጅ',
    'WAITER': 'አስተናጋጅ',
    'BARISTA': 'ባሪስታ',
    'CHEF': 'ሼፍ',
    'CASHIER': 'ገንዘብ ተቀባይ',
    // Audit log actions (Flagged Attempts table)
    'ORDER_CREATED': 'ትዕዛዝ ተፈጥሯል',
    'ORDER_EDIT_ATTEMPT': 'የማስተካከል ሙከራ',
    'ORDER_VOID_ATTEMPT': 'የመሰረዝ ሙከራ',
    'ORDER_DELETE_ATTEMPT': 'የማጥፋት ሙከራ',
    'ORDER_STATUS_CHANGE': 'የሁኔታ ለውጥ',
    'Cashier / Manager sign in': 'ገንዘብ ተቀባይ / ሥራ አስኪያጅ መግቢያ',
    'Chef / Manager sign in': 'ሼፍ / ሥራ አስኪያጅ መግቢያ',
    'Barista / Manager sign in': 'ባሪስታ / ሥራ አስኪያጅ መግቢያ',
    'Waiter sign in': 'አስተናጋጅ መግቢያ',
    'Manager sign in': 'ሥራ አስኪያጅ መግቢያ',
    "No cashier account yet? Create one from the Manager Dashboard's Staff tab (role: Cashier).":
      'የገንዘብ ተቀባይ መለያ የለም? ከሥራ አስኪያጅ ገጽ "ሠራተኞች" ክፍል ይፍጠሩ (ሚና፦ ገንዘብ ተቀባይ)።',
    'This account is not a cashier or manager account.': 'ይህ የገንዘብ ተቀባይ ወይም የሥራ አስኪያጅ መለያ አይደለም።',
    'This screen is for chef or manager accounts.': 'ይህ ገጽ ለሼፍ ወይም ለሥራ አስኪያጅ ብቻ ነው።',
    'This screen is for barista or manager accounts.': 'ይህ ገጽ ለባሪስታ ወይም ለሥራ አስኪያጅ ብቻ ነው።',
    'This dashboard is for manager accounts only.': 'ይህ ገጽ ለሥራ አስኪያጅ ብቻ ነው።',
    'Your login expired — sign in again to keep receiving orders.': 'የመግቢያ ጊዜዎ አልፏል — ትዕዛዞችን ለመቀበል እንደገና ይግቡ።',
    'Your login expired — sign in again to keep taking orders.': 'የመግቢያ ጊዜዎ አልፏል — ትዕዛዝ ለመቀበል እንደገና ይግቡ።',
    'This account is no longer active': 'ይህ መለያ ከአሁን በኋላ አይሰራም',

    // Connection
    'Connection lost — new orders may not appear. Check the Wi-Fi.': 'ግንኙነት ተቋርጧል — አዲስ ትዕዛዞች ላይታዩ ይችላሉ። ዋይፋዩን ያረጋግጡ።',
    'Connection lost — "ready" alerts may not appear. Check the Wi-Fi.': 'ግንኙነት ተቋርጧል — "ዝግጁ ነው" ማሳወቂያዎች ላይታዩ ይችላሉ። ዋይፋዩን ያረጋግጡ።',

    // Food / drink words
    'Drinks': 'መጠጦች',
    'Drink': 'መጠጥ',
    'Meals': 'ምግቦች',
    'Meal': 'ምግብ',
    'Food': 'ምግብ',
    'Snacks': 'ቀላል ምግቦች',
    'Snack': 'ቀላል ምግብ',
    'Top Items': 'ተወዳጆች',
    'Top Item': 'ተወዳጅ',
    'Hot': 'ትኩስ',
    'Cold': 'ቀዝቃዛ',
    'Normal': 'መደበኛ',
    'Normal + Ice': 'መደበኛ + በረዶ',
    'Temperature': 'ሙቀት',
    'Ingredients': 'ግብአቶች',
    'Extras': 'ተጨማሪዎች',
    'Quantity': 'ብዛት',
    'Item': 'ዕቃ',
    'Items': 'ዕቃዎች',
    'ITEMS': 'ዕቃዎች',
    'Price': 'ዋጋ',
    'Total': 'ጠቅላላ',
    'TOTAL': 'ጠቅላላ',
    'No customizations': 'ማስተካከያ የለም',

    // Ordering (cashier New Order + waiter)
    'New Order': 'አዲስ ትዕዛዝ',
    'Open Bills': 'ያልተከፈሉ ሂሳቦች',
    'Payment History': 'የክፍያ ታሪክ',
    'Choose the waitress': 'አስተናጋጅ ይምረጡ',
    'Choose the table': 'ጠረጴዛ ይምረጡ',
    'Now choose the waitress': 'አሁን አስተናጋጅ ይምረጡ',
    'Now choose the table': 'አሁን ጠረጴዛ ይምረጡ',
    'Choose the waitress and table again': 'አስተናጋጅና ጠረጴዛ እንደገና ይምረጡ',
    'Table': 'ጠረጴዛ',
    'Back to Menu': 'ወደ ሜኑ ተመለስ',
    'Back to Tables': 'ወደ ጠረጴዛዎች ተመለስ',
    'View Order / Checkout': 'ትዕዛዙን ይመልከቱ',
    'Order Summary': 'የትዕዛዝ ማጠቃለያ',
    'Accept Order': 'ትዕዛዙን ላክ',
    'Add —': 'ጨምር —',
    'Add': 'ጨምር',
    'Add one': 'አንድ ጨምር',
    'Remove one': 'አንድ ቀንስ',
    'Order is empty': 'ትዕዛዙ ባዶ ነው',
    'Cart is empty': 'ትዕዛዙ ባዶ ነው',
    'Please select a temperature first': 'እባክዎ መጀመሪያ ሙቀት ይምረጡ',
    'Pick a temperature first': 'መጀመሪያ ሙቀት ይምረጡ',
    'Failed to send order': 'ትዕዛዙን መላክ አልተቻለም',
    'Failed to load the menu': 'ሜኑውን መጫን አልተቻለም',
    'No items in this category.': 'በዚህ ምድብ ውስጥ ምንም ዕቃ የለም።',
    'Select a table to begin': 'ለመጀመር ጠረጴዛ ይምረጡ',
    'Select a table to start an order': 'ትዕዛዝ ለመጀመር ጠረጴዛ ይምረጡ',
    'Ordering for': 'ትዕዛዝ ለ',
    'Order sent to the kitchen/bar!': 'ትዕዛዙ ወደ ኩሽና/ባር ተልኳል!',
    'My Orders': 'የእኔ ትዕዛዞች',
    'No orders sent on this day.': 'በዚህ ቀን የተላከ ትዕዛዝ የለም።',
    'No updates yet.': 'እስካሁን ምንም የለም።',
    'Ticket': 'ትኬት',
    'Your order': 'ትዕዛዝዎ',
    'your table': 'ጠረጴዛዎ',
    'An order was voided by a manager': 'አንድ ትዕዛዝ በሥራ አስኪያጅ ተሰርዟል',
    'Cancelling requires manager approval': 'መሰረዝ የሥራ አስኪያጅ ፈቃድ ይፈልጋል',
    'Pick the waitress this order is for': 'ይህ ትዕዛዝ የማን እንደሆነ አስተናጋጅ ይምረጡ',
    'No active waitress accounts — add one in the Manager Dashboard\'s Staff tab.': 'ንቁ የአስተናጋጅ መለያ የለም — ከሥራ አስኪያጅ ገጽ "ሠራተኞች" ክፍል ይጨምሩ።',

    // Statuses
    'Pending': 'በመጠባበቅ ላይ',
    'In Progress': 'በዝግጅት ላይ',
    'Completed': 'ተጠናቋል',
    'Voided': 'ተሰርዟል',
    'Done': 'ተጠናቋል',
    'Active': 'ንቁ',
    'Inactive': 'የቦዘነ',
    'Available': 'ይገኛል',
    'Removed': 'ተወግዷል',

    // Kitchen / Bar screens
    'Active Queue': 'ወረፋ',
    'Recent Completed': 'የተጠናቀቁ',
    'Start Preparing': 'ዝግጅት ጀምር',
    'Mark Complete': 'ዝግጁ ሆኗል',
    'View Details': 'ዝርዝር',
    'Ticket Details': 'የትዕዛዝ ዝርዝር',
    'Mute chime': 'ድምፅ አጥፋ',
    'No active tickets. New orders will flash in here.': 'ምንም ትዕዛዝ የለም። አዲስ ትዕዛዞች እዚህ ይታያሉ።',
    'No active tickets. New food orders will flash in here.': 'ምንም ትዕዛዝ የለም። አዲስ የምግብ ትዕዛዞች እዚህ ይታያሉ።',
    'Completed tickets will appear here.': 'የተጠናቀቁ ትዕዛዞች እዚህ ይታያሉ።',
    'Failed to start preparing this ticket — try again.': 'ዝግጅቱን መጀመር አልተቻለም — እንደገና ይሞክሩ።',
    'Failed to mark this ticket complete — try again.': 'ትዕዛዙን ዝግጁ ማድረግ አልተቻለም — እንደገና ይሞክሩ።',

    // Cashier: bills & payments
    'Table Bill': 'የጠረጴዛ ሂሳብ',
    'Tap to view & pay →': 'ለማየትና ለመክፈል ይንኩ →',
    'Tap to view & pay': 'ለማየትና ለመክፈል ይንኩ',
    'No completed orders waiting on payment right now.': 'አሁን ክፍያ የሚጠብቅ ትዕዛዝ የለም።',
    'Payment method': 'የክፍያ መንገድ',
    'Payment': 'ክፍያ',
    'Cash': 'ጥሬ ገንዘብ',
    'Card': 'ካርድ',
    'Mobile Money': 'ሞባይል ገንዘብ',
    'Other Mobile Money': 'ሌላ ሞባይል ገንዘብ',
    'Payment proof photo (optional)': 'የክፍያ ማረጋገጫ ፎቶ (አማራጭ)',
    'Take Photo': 'ፎቶ አንሳ',
    'Upload Screenshot': 'ስክሪንሾት ጫን',
    "For Telebirr/CBE/BOA — take a photo of the customer's transaction confirmation, or upload a screenshot of it.":
      'ለቴሌብር/ሲቢኢ/ቦኤ — የደንበኛውን የክፍያ ማረጋገጫ ፎቶ ያንሱ ወይም ስክሪንሾቱን ይጫኑ።',
    'Mark Paid & Print Receipt': 'ተከፍሏል — ደረሰኝ አትም',
    'Payment recorded': 'ክፍያው ተመዝግቧል',
    'Failed to record payment': 'ክፍያውን መመዝገብ አልተቻለም',
    'This bill was just paid on another screen': 'ይህ ሂሳብ በሌላ ስክሪን ተከፍሏል',
    'No payments recorded on this day.': 'በዚህ ቀን የተመዘገበ ክፍያ የለም።',
    'Reprint': 'እንደገና አትም',
    'Screenshot no longer available': 'ስክሪንሾቱ አይገኝም',
    'Failed to load open bills': 'ያልተከፈሉ ሂሳቦችን መጫን አልተቻለም',
    'Failed to load payment history': 'የክፍያ ታሪክን መጫን አልተቻለም',
    'Done — waitress told': 'ተጠናቋል — ለአስተናጋጇ ተነግሯል',
    'Food ready': 'ምግብ ዝግጁ ነው',
    'Drinks ready': 'መጠጥ ዝግጁ ነው',
    'Order ready': 'ትዕዛዝ ዝግጁ ነው',
    'Receipt': 'ደረሰኝ',
    'RECEIPT': 'ደረሰኝ',
    'Proof': 'ማረጋገጫ',
    'Screenshot on file': 'ስክሪንሾት ተቀምጧል',
    'Unauthorized': 'ፈቃድ የለዎትም',

    // Camera
    'Capture': 'አንሳ',
    'Retake': 'እንደገና አንሳ',
    'Use Photo': 'ፎቶውን ተጠቀም',
    'Switch': 'ቀይር',
    'Switch camera': 'ካሜራ ቀይር',
    'Camera access was blocked. Click the camera icon in the address bar and choose "Allow", then try again.':
      'የካሜራ ፈቃድ ታግዷል። በአድራሻ መስመሩ ያለውን የካሜራ ምልክት ይጫኑና "Allow" ይምረጡ፣ ከዚያ እንደገና ይሞክሩ።',
    'No camera found on this device. Use "Upload Screenshot" instead.': 'በዚህ መሳሪያ ካሜራ አልተገኘም። "ስክሪንሾት ጫን"ን ይጠቀሙ።',

    // Manager dashboard
    'Overview': 'አጠቃላይ እይታ',
    'Orders': 'ትዕዛዞች',
    'Staff': 'ሠራተኞች',
    'Stock': 'ክምችት',
    'Orders Placed': 'የተሰጡ ትዕዛዞች',
    'Orders Voided': 'የተሰረዙ ትዕዛዞች',
    'Revenue (Live)': 'ገቢ (ቀጥታ)',
    'Revenue (Logged)': 'ገቢ (የተመዘገበ)',
    'Reconciled': 'ማመሳከሪያ',
    'Match': 'ይዛመዳል',
    'Blocked Attempts': 'የታገዱ ሙከራዎች',
    'Items Ordered —': 'የታዘዙ ዕቃዎች —',
    'Daily': 'ዕለታዊ',
    'Weekly': 'ሳምንታዊ',
    'Monthly': 'ወርሃዊ',
    'Top Sellers': 'በብዛት የተሸጡ',
    'Flagged Attempts (blocked void/delete/edit)': 'የታገዱ ሙከራዎች (ስረዛ/ማጥፋት/ማስተካከል)',
    'No blocked attempts on this day.': 'በዚህ ቀን የታገደ ሙከራ የለም።',
    'No items ordered on this day.': 'በዚህ ቀን የታዘዘ ዕቃ የለም።',
    'No orders on this day.': 'በዚህ ቀን ትዕዛዝ የለም።',
    'All Orders': 'ሁሉም ትዕዛዞች',
    'All Items': 'ሁሉም ዕቃዎች',
    'Category': 'ምድብ',
    'Categories': 'ምድቦች',
    'Revenue': 'ገቢ',
    'Status': 'ሁኔታ',
    'Action': 'ተግባር',
    'Order': 'ትዕዛዝ',
    'Name': 'ስም',
    'Role': 'ሚና',
    'Sold': 'የተሸጠ',
    'Actor': 'ፈጻሚ',
    'Placed': 'የታዘዘበት',
    'Server': 'አስተናጋጅ',
    'Void': 'ሰርዝ',
    'Void Order': 'ትዕዛዝ ሰርዝ',
    'Order voided': 'ትዕዛዙ ተሰርዟል',
    'Reason': 'ምክንያት',
    'e.g. duplicate entry, customer walked out': 'ለምሳሌ፦ ሁለት ጊዜ የገባ፣ ደንበኛው ሄዷል',
    'This cannot be undone. The order stays on record as voided.': 'ይህ አይመለስም። ትዕዛዙ እንደተሰረዘ ተመዝግቦ ይቆያል።',
    'No reason given': 'ምክንያት አልተሰጠም',
    'Order Details': 'የትዕዛዝ ዝርዝር',
    'Voided at': 'የተሰረዘበት ሰዓት',
    'Voided by': 'የሰረዘው',
    'Not yet paid': 'ገና አልተከፈለም',
    'View Receipt': 'ደረሰኝ ተመልከት',
    'View Screenshot': 'ስክሪንሾት ተመልከት',
    'No screenshot uploaded for this transaction': 'ለዚህ ክፍያ ስክሪንሾት አልተጫነም',
    'No screenshot uploaded for this transaction.': 'ለዚህ ክፍያ ስክሪንሾት አልተጫነም።',
    'Print': 'አትም',
    'Print Summary': 'ማጠቃለያ አትም',
    'Failed to void order': 'ትዕዛዙን መሰረዝ አልተቻለም',
    'Failed to load report': 'ሪፖርቱን መጫን አልተቻለም',
    'Failed to load orders': 'ትዕዛዞችን መጫን አልተቻለም',
    'Failed to load items report': 'የዕቃዎች ሪፖርትን መጫን አልተቻለም',

    // Staff
    'Staff Accounts': 'የሠራተኞች መለያዎች',
    'Add Staff': 'ሠራተኛ ጨምር',
    'Add Staff Account': 'የሠራተኛ መለያ ጨምር',
    'Edit Staff Account': 'የሠራተኛ መለያ አስተካክል',
    'Create Account': 'መለያ ፍጠር',
    'At least 8 characters': 'ቢያንስ 8 ፊደሎች',
    'Activate': 'አንቃ',
    'Deactivate': 'አቦዝን',
    'Account activated': 'መለያው ነቅቷል',
    'Account deactivated': 'መለያው ቦዝኗል',
    'Account deleted': 'መለያው ተሰርዟል',
    'Account updated': 'መለያው ተስተካክሏል',
    'Staff account created': 'የሠራተኛ መለያ ተፈጥሯል',
    'No staff accounts yet.': 'እስካሁን የሠራተኛ መለያ የለም።',
    'Name and email are required': 'ስምና ኢሜይል ያስፈልጋሉ',
    'You cannot deactivate your own account': 'የራስዎን መለያ ማቦዘን አይችሉም',
    'You cannot delete your own account': 'የራስዎን መለያ መሰረዝ አይችሉም',
    'A user with this email already exists': 'በዚህ ኢሜይል ሌላ መለያ አለ',
    'Password must be at least 8 characters': 'የይለፍ ቃል ቢያንስ 8 ፊደሎች መሆን አለበት',
    'Failed to create account': 'መለያ መፍጠር አልተቻለም',
    'Failed to update account': 'መለያውን ማስተካከል አልተቻለም',
    'Failed to delete account': 'መለያውን መሰረዝ አልተቻለም',
    'Failed to load staff': 'ሠራተኞችን መጫን አልተቻለም',

    // Stock
    'Add Stock Item': 'የክምችት ዕቃ ጨምር',
    'Edit Stock Item': 'የክምችት ዕቃ አስተካክል',
    'Updates automatically when linked items are sold — no refresh needed.': 'የተያያዙ ዕቃዎች ሲሸጡ በራሱ ይዘምናል — ማደስ አያስፈልግም።',
    'No stock items yet — add one to start tracking.': 'እስካሁን የክምችት ዕቃ የለም — ለመከታተል አንድ ይጨምሩ።',
    'Quantity on hand': 'ያለው ብዛት',
    'Unit': 'መለኪያ',
    'Low stock alert below': 'ከዚህ በታች ሲቀንስ አሳውቅ',
    'Low Stock': 'ክምችት ቀንሷል',
    'Linked Menu Items': 'የተያያዙ የሜኑ ዕቃዎች',
    'Link Menu Item': 'የሜኑ ዕቃ አያይዝ',
    'Link': 'አያይዝ',
    'Remove link': 'ግንኙነቱን አስወግድ',
    'Menu item': 'የሜኑ ዕቃ',
    'Quantity used per sale': 'በአንድ ሽያጭ የሚወጣ ብዛት',
    'Selling this menu item will draw down this stock item automatically.': 'ይህ የሜኑ ዕቃ ሲሸጥ ከክምችቱ በራሱ ይቀነሳል።',
    'Linked — this menu item will now draw down this stock': 'ተያይዟል — ይህ የሜኑ ዕቃ ሲሸጥ ከክምችቱ ይቀነሳል',
    'e.g. bottles, kg, pcs, crates': 'ለምሳሌ፦ ጠርሙስ፣ ኪሎ፣ ፍሬ፣ ሳጥን',
    'e.g. 1 bottle per drink, or 0.02 kg of beans per coffee': 'ለምሳሌ፦ ለአንድ መጠጥ 1 ጠርሙስ',
    'optional — e.g. 5': 'አማራጭ — ለምሳሌ 5',
    'Stock item added': 'የክምችት ዕቃ ተጨምሯል',
    'Stock item updated': 'የክምችት ዕቃ ተስተካክሏል',
    'Quantity updated': 'ብዛቱ ተስተካክሏል',
    'Enter a valid quantity': 'ትክክለኛ ብዛት ያስገቡ',
    'Quantity per sale must be greater than 0': 'በአንድ ሽያጭ የሚወጣ ብዛት ከ0 በላይ መሆን አለበት',
    'Pick a menu item': 'የሜኑ ዕቃ ይምረጡ',
    'Failed to load stock': 'ክምችቱን መጫን አልተቻለም',
    'Failed to save stock item': 'የክምችት ዕቃውን ማስቀመጥ አልተቻለም',
    'Failed to delete stock item': 'የክምችት ዕቃውን መሰረዝ አልተቻለም',
    'Failed to update quantity': 'ብዛቱን ማስተካከል አልተቻለም',
    'Failed to link menu item': 'የሜኑ ዕቃውን ማያያዝ አልተቻለም',
    'Failed to remove link': 'ግንኙነቱን ማስወገድ አልተቻለም',

    // Menu management
    'Add Menu Item': 'የሜኑ ዕቃ ጨምር',
    'Add Item': 'ዕቃ ጨምር',
    'Edit Menu Item': 'የሜኑ ዕቃ አስተካክል',
    'Item name': 'የዕቃ ስም',
    'Item name is required': 'የዕቃ ስም ያስፈልጋል',
    'Search items or categories…': 'ዕቃ ወይም ምድብ ይፈልጉ…',
    'Search menu items': 'የሜኑ ዕቃዎችን ፈልግ',
    'Prices and availability changes apply to new orders right away.': 'የዋጋና የመገኘት ለውጦች በአዲስ ትዕዛዞች ላይ ወዲያውኑ ይሰራሉ።',
    'Available on the menu right now': 'አሁን በሜኑ ላይ ይገኛል',
    'Mark as Top': 'ተወዳጅ አድርግ',
    "Top Item — show in the waiters' quick-access shortcut": 'ተወዳጅ — በአስተናጋጆቹ ፈጣን ምርጫ ላይ አሳይ',
    "Show this item in the waiters' Top Items shortcut": 'ይህን ዕቃ በአስተናጋጆቹ "ተወዳጆች" ላይ አሳይ',
    'Offers a temperature choice': 'የሙቀት ምርጫ አለው',
    'Removable ingredients (comma separated)': 'ሊወጡ የሚችሉ ግብአቶች (በነጠላ ሰረዝ ይለዩ)',
    'e.g. onions, pickles, cheese': 'ለምሳሌ፦ ሽንኩርት፣ ቃሪያ፣ አይብ',
    'Add Extra': 'ተጨማሪ ጨምር',
    'Extra name': 'የተጨማሪው ስም',
    'Picture (paste an image link)': 'ፎቶ (የምስል ሊንክ ይለጥፉ)',
    'Pick a category': 'ምድብ ይምረጡ',
    'Enter a valid price': 'ትክክለኛ ዋጋ ያስገቡ',
    'Pick at least one temperature option, or uncheck "Offers a temperature choice"': 'ቢያንስ አንድ የሙቀት አማራጭ ይምረጡ፣ ወይም "የሙቀት ምርጫ አለው"ን ያንሱ',
    'Menu item added': 'የሜኑ ዕቃ ተጨምሯል',
    'Menu item updated': 'የሜኑ ዕቃ ተስተካክሏል',
    'Price updated': 'ዋጋው ተስተካክሏል',
    'No menu items yet — add one to get started.': 'እስካሁን የሜኑ ዕቃ የለም — ለመጀመር አንድ ይጨምሩ።',
    'Failed to load menu items': 'የሜኑ ዕቃዎችን መጫን አልተቻለም',
    'Failed to save menu item': 'የሜኑ ዕቃውን ማስቀመጥ አልተቻለም',
    'Failed to delete menu item': 'የሜኑ ዕቃውን መሰረዝ አልተቻለም',
    'Failed to update price': 'ዋጋውን ማስተካከል አልተቻለም',
    'Failed to update availability': 'መገኘቱን ማስተካከል አልተቻለም',
    'Failed to update': 'ማስተካከል አልተቻለም',
    'A menu item with this name already exists': 'በዚህ ስም ሌላ የሜኑ ዕቃ አለ',
    "This item has past orders and can't be deleted — mark it Removed instead to keep it off the menu without breaking order history.":
      'ይህ ዕቃ የቆዩ ትዕዛዞች አሉት፣ ስለዚህ መሰረዝ አይቻልም — የትዕዛዝ ታሪኩ እንዳይበላሽ "ተወግዷል" ያድርጉት።',

    // Categories panel
    'Drinks go to the Barista screen, Meals and Snacks to the Chef. A category can only be deleted once it\'s empty.':
      'መጠጦች ወደ ባሪስታ፣ ምግቦች ወደ ሼፍ ይሄዳሉ። ምድብ መሰረዝ የሚቻለው ባዶ ሲሆን ብቻ ነው።',
    'Add category': 'ምድብ ጨምር',
    'Sub': 'ንዑስ',
    'No categories yet.': 'እስካሁን ምድብ የለም።',
    'Drinks → Barista': 'መጠጦች → ባሪስታ',
    'Meals → Chef': 'ምግቦች → ሼፍ',
    'Snacks → Chef': 'ቀላል ምግቦች → ሼፍ',
    'Delete its sub-categories first': 'መጀመሪያ ንዑስ ምድቦቹን ይሰርዙ',
    'Move or delete its items first': 'መጀመሪያ ዕቃዎቹን ያንቀሳቅሱ ወይም ይሰርዙ',
    'It has items directly in it': 'በቀጥታ ዕቃዎች አሉት',
    'It has items directly in it — move them into a sub-category first': 'በቀጥታ ዕቃዎች አሉት — መጀመሪያ ወደ ንዑስ ምድብ ያንቀሳቅሷቸው',
    'Failed to add category': 'ምድብ መጨመር አልተቻለም',
    'Failed to rename category': 'የምድቡን ስም መቀየር አልተቻለም',
    'Failed to delete category': 'ምድቡን መሰረዝ አልተቻለም',
    'Failed to load categories': 'ምድቦችን መጫን አልተቻለም',
    'Enter a category name': 'የምድብ ስም ያስገቡ',
    'Category name is too long (60 characters max)': 'የምድቡ ስም በጣም ረጅም ነው (ከ60 ፊደል አይበልጥ)',
  };

  // ---------------- Phrases with a changing part ----------------
  // Each: [regex on the English, function(...captures) -> Amharic].
  // Captures that are themselves app words are passed through t().
  // Dates the screens print in English (same Gregorian calendar as the
  // app uses everywhere, with Amharic day and month names)
  const DAYS = {
    Mon: 'ሰኞ', Tue: 'ማክሰኞ', Wed: 'ረቡዕ', Thu: 'ሐሙስ', Fri: 'ዓርብ', Sat: 'ቅዳሜ', Sun: 'እሑድ',
    Monday: 'ሰኞ', Tuesday: 'ማክሰኞ', Wednesday: 'ረቡዕ', Thursday: 'ሐሙስ', Friday: 'ዓርብ', Saturday: 'ቅዳሜ', Sunday: 'እሑድ',
  };
  const MONTHS = {
    Jan: 'ጃንዩወሪ', Feb: 'ፌብሩወሪ', Mar: 'ማርች', Apr: 'ኤፕሪል', May: 'ሜይ', Jun: 'ጁን',
    Jul: 'ጁላይ', Aug: 'ኦገስት', Sep: 'ሴፕቴምበር', Oct: 'ኦክቶበር', Nov: 'ኖቬምበር', Dec: 'ዲሴምበር',
  };

  const PATTERNS = [
    // "Fri, Sep 25, 2026" / "Sep 25, 2026" / "Fri, Sep 25"
    [/^(?:(Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?), )?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})(?:, (\d{4}))?$/,
      (d, m, day, y) => `${d ? DAYS[d] + '፣ ' : ''}${MONTHS[m]} ${day}${y ? '፣ ' + y : ''}`],
    [/^(\d+) · (.+)$/, (n, rest) => `${n} · ${tx(rest)}`], // "1 · Choose the waitress"
    [/^(#\w+) · (.+)$/, (id, rest) => `${id} · ${tx(rest)}`], // "#GG77HH · Table T3"
    [/^(#\w+) — (.+)$/, (id, rest) => `${id} — ${tx(rest)}`], // "#AA11B — Table T2"
    [/^- No (.+)$/, (x) => `- ያለ ${x}`], // removed ingredient on a ticket
    [/^\+ ?(.+)$/, (x) => `+ ${tx(x)}`], // "+ Link", or an added extra (a name — kept)
    [/^(\d+) items? · \$([\d.,]+)$/, (n, p) => `${n} ዕቃ · $${p}`],
    [/^(\d+) items?$/, (n) => `${n} ዕቃ`],
    [/^(\d+) sub-categor(?:y|ies)$/, (n) => `${n} ንዑስ ምድብ`],
    [/^\$([\d.,]+) each$/, (p) => `አንዱ $${p}`],
    [/^\$([\d.,]+) base$/, (p) => `መነሻ $${p}`],
    [/^(\d+)m (\d+)s ago$/, (m, s) => `ከ${m} ደቂቃ ${s} ሰከንድ በፊት`],
    [/^(\d+)s ago$/, (s) => `ከ${s} ሰከንድ በፊት`],
    [/^(\d+)m ago$/, (m) => `ከ${m} ደቂቃ በፊት`],
    [/^Table (\S+) · (.+)$/, (tb, w) => `ጠረጴዛ ${tb} · ${w}`],
    [/^Table (\S+)$/, (tb) => `ጠረጴዛ ${tb}`],
    [/^Table (\S+) is ready for checkout$/, (tb) => `ጠረጴዛ ${tb} ለክፍያ ዝግጁ ነው`],
    [/^Table (\S+) ready for checkout$/, (tb) => `ጠረጴዛ ${tb} ለክፍያ ዝግጁ ነው`],
    [/^Sent to kitchen\/bar — Table (\S+) for (.+)$/, (tb, w) => `ወደ ኩሽና/ባር ተልኳል — ጠረጴዛ ${tb}፣ ${w}`],
    [/^tell (.+)$/, (w) => `ለ${w} ይንገሩ`],
    [/^Order #(\w+)$/, (id) => `ትዕዛዝ #${id}`],
    [/^Serving (.+)$/, (tb) => `${tb}ን በማስተናገድ ላይ`],
    [/^Order for (.+) is ready!$/, (tb) => `የ${tb} ትዕዛዝ ዝግጁ ነው!`],
    [/^(Kitchen|Bar) ready for (.+)$/, (st, tb) => `${t(st)} ለ${tb} ዝግጁ ነው`],
    [/^Ticket for (.+)$/, (tb) => `የ${tb} ትዕዛዝ`],
    [/^Waiter: (.+)$/, (w) => `አስተናጋጅ፦ ${w}`],
    [/^Note: (.+)$/, (n) => `ማስታወሻ፦ ${n}`],
    [/^no (.+)$/, (x) => `ያለ ${x}`],
    [/^(.+) · paid by (.+) · (.+)$/, (w, c, time) => `${w} · የከፈለው ${c} · ${time}`],
    [/^Backup saved: (.+)$/, (f) => `ምትኬ ተቀምጧል፦ ${f}`],
    [/^Couldn't load the menu \((.*)\)\.?$/, (e) => `ሜኑውን መጫን አልተቻለም (${e})።`],
    [/^Couldn't start the camera \((.*)\)\.$/, (e) => `ካሜራውን ማስጀመር አልተቻለም (${e})።`],
    [/^Something went wrong loading the (menu|queue): (.*)$/, (_w, e) => `መጫን አልተቻለም፦ ${e}`],
    [/^Request failed:? \(?(\d+)\)?$/, (c) => `ጥያቄው አልተሳካም (${c})`],
    [/^Delete failed \((\d+)\)$/, (c) => `መሰረዝ አልተሳካም (${c})`],
    [/^Added "(.+)"$/, (n) => `"${n}" ተጨምሯል`],
    [/^Renamed to "(.+)"$/, (n) => `ስሙ ወደ "${n}" ተቀይሯል`],
    [/^Deleted "(.+)"$/, (n) => `"${n}" ተሰርዟል`],
    [/^New category under "(.+)":$/, (p) => `በ"${p}" ስር አዲስ ምድብ፦`],
    [/^Rename "(.+)" to:$/, (p) => `"${p}"ን ወደ ምን ይቀይሩ፦`],
    [/^Delete the category "(.+)"\? It's empty, so no menu items are affected\.$/, (p) => `"${p}" ምድብን ልሰርዝ? ባዶ ስለሆነ ምንም የሜኑ ዕቃ አይነካም።`],
    [/^Delete the whole "(.+)" section\?.*$/, (p) => `ሙሉውን "${p}" ክፍል ልሰርዝ? ከአስተናጋጅና ከገንዘብ ተቀባይ ገጾች ይጠፋል፣ ከዚህ መልሶ መጨመርም አይቻልም (አዲስ ምግብ በ"ምግቦች" ስር መግባት ይችላል)።`],
    [/^Delete "(.+)" completely\?.*$/, (n) => `"${n}"ን ሙሉ በሙሉ ልሰርዝ? የቆዩ ትዕዛዞች ካሉት "ተወግዷል" ይጠቀሙ — ካሉት ይነግርዎታል።`],
    [/^Remove "(.+)" from stock tracking\?.*$/, (n) => `"${n}"ን ከክምችት ክትትል ላስወግድ? ከሜኑ ዕቃዎች ጋር ያለው ግንኙነትም ይወገዳል።`],
    [/^Permanently delete "(.+)"'s account\?.*$/, (n) => `የ"${n}"ን መለያ ሙሉ በሙሉ ልሰርዝ? ይህ አይመለስም። የትዕዛዝ ታሪክ ካላቸው አይሰረዝም — በምትኩ ያቦዝኑ።`],
    [/^No items match "(.+)"\.$/, (q) => `"${q}" የሚመስል ዕቃ የለም።`],
    [/^No (drinks|food) items on the menu\.$/, (c) => `በሜኑ ላይ ${c === 'drinks' ? 'መጠጥ' : 'ምግብ'} የለም።`],
    [/^No (drinks|food) items on this day\.$/, (c) => `በዚህ ቀን ${c === 'drinks' ? 'መጠጥ' : 'ምግብ'} የለም።`],
    [/^No (drinks|food) items ordered on this day\.$/, (c) => `በዚህ ቀን የታዘዘ ${c === 'drinks' ? 'መጠጥ' : 'ምግብ'} የለም።`],
    [/^Off by \$([\d.,]+)$/, (p) => `በ$${p} ልዩነት አለ`],
    [/^This Week \((.+)\)$/, (r) => `ይህ ሳምንት (${r})`],
    [/^This Month \((.+)\)$/, (r) => `ይህ ወር (${r})`],
    [/^Delete or move its (items|categories) first$/, (x) => (x === 'items' ? 'መጀመሪያ ዕቃዎቹን ያንቀሳቅሱ ወይም ይሰርዙ' : 'መጀመሪያ ንዑስ ምድቦቹን ይሰርዙ')],
    [/^A category named "(.+)" already exists$/, (n) => `"${n}" የተባለ ምድብ አስቀድሞ አለ`],
    [/^"(.+)" can't be (renamed|deleted) — .*$/, (n, a) => `"${n}"ን ${a === 'renamed' ? 'መቀየር' : 'መሰረዝ'} አይቻልም — ትዕዛዞቹ ወደ ሼፍ ወይም ባሪስታ የሚሄዱት በእሱ ነው`],
    [/^"(.+)" still has (\d+) sub-categor(?:y|ies) — delete those first$/, (n, c) => `"${n}" ውስጥ ${c} ንዑስ ምድብ አለ — መጀመሪያ እነሱን ይሰርዙ`],
    [/^"(.+)" still has (\d+) menu item\(s\).*$/, (n, c) => `"${n}" ውስጥ ${c} የሜኑ ዕቃ አለ — መጀመሪያ ያንቀሳቅሱ ወይም ይሰርዙ`],
    [/^"(.+)" has (\d+) item\(s\) directly in it\..*$/, (n, c) => `"${n}" ውስጥ በቀጥታ ${c} ዕቃ አለ። መጀመሪያ ወደ ንዑስ ምድብ ያንቀሳቅሷቸው — አለዚያ ከትዕዛዝ ገጾች ይጠፋሉ።`],
    [/^"(.+)" is already the deepest level.*$/, (n) => `"${n}" የመጨረሻው ደረጃ ነው — ምድቡን አንድ ደረጃ ከፍ ብለው ይጨምሩ`],
    [/^"(.+)" has sub-categories — put the item in one of them.*$/, (n) => `"${n}" ንዑስ ምድቦች አሉት — ዕቃውን ከእነሱ በአንዱ ያስገቡ`],
    [/^Order #(\w+) is not payable.*$/, (id) => `ትዕዛዝ #${id} ሊከፈል አይችልም (መጠናቀቅ አለበት፣ የተሰረዘ ወይም የተከፈለ መሆን የለበትም)`],
  ];

  let lang = 'en';
  try {
    lang = localStorage.getItem(STORAGE_KEY) === 'am' ? 'am' : 'en';
  } catch (e) {
    // storage unavailable — stay on English
  }

  // Translate one English string (keeps surrounding whitespace and any
  // leading/trailing symbols). Returns the input unchanged if unknown.
  function t(text) {
    if (lang !== 'am' || typeof text !== 'string') return text;
    const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const core = m[2].replace(/\s+/g, ' ');
    if (!/[A-Za-z]/.test(core)) return text;
    const out = lookup(core);
    return out === null ? text : m[1] + out + m[3];
  }

  // Translate a fragment inside a pattern, or keep it as-is (e.g. a name)
  function tx(fragment) {
    const out = lookup(fragment);
    return out === null ? fragment : out;
  }

  function lookup(core) {
    if (Object.prototype.hasOwnProperty.call(AM, core)) return AM[core];
    for (const [re, fn] of PATTERNS) {
      const r = core.match(re);
      if (r) return fn(...r.slice(1));
    }
    // Decorative prefix/suffix: "📷 Take Photo", "← Back", "Add —", "Close ✕"
    const d = core.match(/^([^\p{L}\p{N}"'#$]*)(.*?)([^\p{L}\p{N}"'.!?)]*)$/u);
    if (d && (d[1] || d[3]) && d[2] && d[2] !== core) {
      const inner = lookup(d[2]);
      if (inner !== null) return d[1] + inner + d[3];
    }
    // Lists joined with a separator, e.g. an item's notes
    // "🔥 Hot • no Onions • +Extra Shot" or "Hot · no Onions"
    for (const sep of [' • ', ' · ', ', ']) {
      if (!core.includes(sep)) continue;
      const parts = core.split(sep);
      const translated = parts.map(tx);
      if (translated.some((p, i) => p !== parts[i])) return translated.join(sep === ', ' ? '፣ ' : sep);
    }
    return null;
  }

  // ---------------- Applying to the page ----------------
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE']);
  // data-label: the Manager tables' column names shown on phones (admin.js
  // copies them from the table headers — see labelTableForPhone)
  const ATTRS = ['placeholder', 'title', 'aria-label', 'data-label'];
  const textState = new WeakMap(); // Text node -> { en, shown }
  const attrState = new WeakMap(); // Element -> { [attr]: { en, shown } }

  function skipped(el) {
    for (let e = el; e; e = e.parentElement) {
      if (SKIP_TAGS.has(e.tagName) || (e.hasAttribute && e.hasAttribute('data-no-i18n'))) return true;
    }
    return false;
  }

  function applyText(node) {
    if (!node.parentElement || skipped(node.parentElement)) return;
    const st = textState.get(node);
    // If the screen replaced the text since we last touched it, that new
    // text is the English original from now on.
    const en = st && (node.data === st.shown || node.data === st.en) ? st.en : node.data;
    const shown = lang === 'am' ? t(en) : en;
    textState.set(node, { en, shown });
    if (node.data !== shown) node.data = shown;
  }

  function applyAttrs(el) {
    if (skipped(el)) return;
    let st = attrState.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a);
      const prev = st && st[a];
      const en = prev && (cur === prev.shown || cur === prev.en) ? prev.en : cur;
      const shown = lang === 'am' ? t(en) : en;
      if (!st) {
        st = {};
        attrState.set(el, st);
      }
      st[a] = { en, shown };
      if (cur !== shown) el.setAttribute(a, shown);
    }
  }

  function applyTree(root) {
    if (root.nodeType === Node.TEXT_NODE) return applyText(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (skipped(root)) return;
    applyAttrs(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) applyText(n);
      else applyAttrs(n);
    }
  }

  function applyAll() {
    document.documentElement.lang = lang === 'am' ? 'am' : 'en';
    document.documentElement.classList.toggle('lang-am', lang === 'am');
    applyTree(document.body);
    updateToggles();
  }

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach(applyTree);
      else if (r.type === 'characterData') applyText(r.target);
      else if (r.type === 'attributes') applyAttrs(r.target);
    }
  });

  // Pop-ups built with confirm() / prompt() / alert() get translated too
  const nativeConfirm = window.confirm.bind(window);
  const nativePrompt = window.prompt.bind(window);
  const nativeAlert = window.alert.bind(window);
  window.confirm = (msg) => nativeConfirm(t(String(msg)));
  window.prompt = (msg, def) => nativePrompt(t(String(msg)), def);
  window.alert = (msg) => nativeAlert(t(String(msg)));

  // ---------------- The EN | አማ switch ----------------
  function makeToggle() {
    const wrap = document.createElement('div');
    wrap.className = 'lang-toggle';
    wrap.setAttribute('data-no-i18n', '');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Language / ቋንቋ');
    wrap.innerHTML = '<button type="button" data-lang="en">EN</button><button type="button" data-lang="am">አማ</button>';
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-lang]');
      if (!btn || btn.dataset.lang === lang) return;
      setLanguage(btn.dataset.lang);
    });
    return wrap;
  }

  function updateToggles() {
    document.querySelectorAll('.lang-toggle button').forEach((b) => {
      b.classList.toggle('active', b.dataset.lang === lang);
      b.setAttribute('aria-pressed', b.dataset.lang === lang ? 'true' : 'false');
    });
  }

  function setLanguage(next) {
    lang = next === 'am' ? 'am' : 'en';
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {
      // not remembered on this device, but still switches now
    }
    applyAll();
  }

  function init() {
    // One switch in each screen header, one on each sign-in card
    document.querySelectorAll('.brand-slot-right').forEach((slot) => slot.prepend(makeToggle()));
    document.querySelectorAll('.login-card').forEach((card) => card.prepend(makeToggle()));
    applyAll();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  }

  window.EbonyI18n = { t, setLanguage, get language() { return lang; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

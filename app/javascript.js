// javascript.js
// File này điều khiển giao diện người dùng, tương tác với assembler và simulator.

import { assembler } from './assembler.js';
import { simulator } from './simulator.js';

// --- Tham chiếu đến các phần tử DOM ---
const instructionInput = document.getElementById('instructionInput');         // Ô nhập liệu mã assembly
const binaryOutput = document.getElementById('binaryOutput');               // Khu vực hiển thị mã nhị phân
const registerTable = document.getElementById('registerTable');             // Bảng thanh ghi số nguyên
const registerTableBody = registerTable?.querySelector('tbody');            // Phần thân của bảng thanh ghi số nguyên
const fpRegisterTable = document.getElementById('fpRegisterTable');         // Bảng thanh ghi điểm động
const fpRegisterTableBody = fpRegisterTable?.querySelector('tbody');        // Phần thân của bảng thanh ghi điểm động
const toggleRegisterViewButton = document.getElementById('toggleRegisterViewButton'); // Nút chuyển đổi giữa các bảng thanh ghi

// Nút điều khiển chính
const assembleButton = document.getElementById('assembleButton');
const runButton = document.getElementById('runButton');
const stepButton = document.getElementById('stepButton');
const resetButton = document.getElementById('resetButton');

// Phần tử DOM cho Data Segment View                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      
const dataSegmentAddressInput = document.getElementById('dataSegmentAddressInput');
const goToDataSegmentAddressButton = document.getElementById('goToDataSegmentAddress');
const toggleDataSegmentModeButton = document.getElementById('toggleDataSegmentMode');
const dataSegmentBody = document.getElementById('dataSegmentBody');

// --- Biến trạng thái cho các thành phần giao diện ---
let dataSegmentStartAddress = 0x10010000; // Địa chỉ bắt đầu mặc định cho Data Segment View
let dataSegmentDisplayMode = 'hex';        // Chế độ hiển thị cho Data Segment ('hex' hoặc 'ascii')
const dataSegmentRows = 8;                 // Số hàng hiển thị trong Data Segment View
const bytesPerRow = 32;                    // Số byte trên mỗi hàng của Data Segment View (8 words)
const wordsPerRow = 8;                     // Số word (cột giá trị) trên mỗi hàng của Data Segment View

let currentRegisterView = 'integer';       // Theo dõi bảng thanh ghi nào đang được hiển thị ('integer' hoặc 'fp')

// --- Khởi tạo bảng thanh ghi ---
// Tên ABI cho các thanh ghi số nguyên (x0-x31)
const abiNames = [
    'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
    's0/fp', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
    'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7',
    's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'
];

// Tên ABI cho các thanh ghi điểm động (f0-f31) - cần kiểm tra và hoàn thiện danh sách này
const fpAbiNames = [
    'ft0', 'ft1', 'ft2', 'ft3', 'ft4', 'ft5', 'ft6', 'ft7', 
    'fs0', 'fs1', 'fa0', 'fa1', 'fa2', 'fa3', 'fa4', 'fa5',
    'fa6', 'fa7', 'fs2', 'fs3', 'fs4', 'fs5', 'fs6', 'fs7',
    'fs8', 'fs9', 'fs10', 'fs11', 'ft8', 'ft9', 'ft10', 'ft11'
];

// Tạo cấu trúc ban đầu cho bảng thanh ghi số nguyên
function initializeRegisterTable() {
    if (!registerTableBody) {
        console.error("DOM element for integer register table body not found!");
        return;
    }
    registerTableBody.innerHTML = ''; // Xóa nội dung cũ nếu có

    // Tạo 32 hàng cho thanh ghi x0-x31
    for (let i = 0; i < 32; i++) {
        const row = registerTableBody.insertRow();
        row.id = `reg-${i}`; // Đặt ID cho mỗi hàng để dễ cập nhật
        row.insertCell().textContent = `x${i} (${abiNames[i]})`; // Cột "Name"
        row.insertCell().textContent = '0x00000000';          // Cột "Value" (Hex)
    }
    // Tạo hàng cho Program Counter (PC)
    const pcRow = registerTableBody.insertRow();
    pcRow.id = 'reg-pc';
    pcRow.insertCell().textContent = 'PC';
    pcRow.insertCell().textContent = '0x00000000';
}

// Tạo cấu trúc ban đầu cho bảng thanh ghi điểm động
function initializeFPRegisterTable() {
    if (!fpRegisterTableBody) {
        console.error("DOM element for floating-point register table body not found!");
        return;
    }
    fpRegisterTableBody.innerHTML = ''; // Xóa nội dung cũ nếu có

    // Tạo 32 hàng cho thanh ghi f0-f31
    for (let i = 0; i < 32; i++) {
        const row = fpRegisterTableBody.insertRow();
        row.id = `freg-${i}`; // Đặt ID cho mỗi hàng
        row.insertCell().textContent = `f${i} (${fpAbiNames[i] || '?'})`; // Cột "Register"
        row.insertCell().textContent = '0.0';                            // Cột "Float Value"
        row.insertCell().textContent = '0x00000000';                    // Cột "Hex (Bits)"
    }
}

// Hiển thị nội dung của vùng nhớ Data Segment
function renderDataSegmentTable() {
    if (!dataSegmentBody || !simulator) {
        if (dataSegmentBody) dataSegmentBody.innerHTML = '<tr><td colspan="9">Simulator not ready or no data loaded.</td></tr>';
        return;
    }
    dataSegmentBody.innerHTML = ''; // Xóa nội dung cũ

    // Lặp qua số hàng cần hiển thị
    for (let i = 0; i < dataSegmentRows; i++) {
        const rowBaseAddress = Math.max(0, dataSegmentStartAddress + i * bytesPerRow); // Địa chỉ bắt đầu của hàng
        const row = dataSegmentBody.insertRow();
        const addrCell = row.insertCell(); // Ô hiển thị địa chỉ
        addrCell.textContent = `0x${rowBaseAddress.toString(16).padStart(8, '0')}`;

        // Lặp qua các word trên mỗi hàng
        for (let j = 0; j < wordsPerRow; j++) {
            const wordStartAddress = rowBaseAddress + j * 4; // Địa chỉ bắt đầu của word
            let displayValue = '';
            let wordValue = 0;      // Giá trị số nguyên của word
            let bytes = [];         // Mảng chứa các byte của word
            let allBytesNull = true; // Cờ kiểm tra xem word có hoàn toàn là null không

            // Đọc 4 byte cho mỗi word (little-endian)
            for (let k = 0; k < 4; k++) {
                const byteAddr = wordStartAddress + k;
                //const byte = simulator.tilelinkMem.readByte[byteAddr] ?? null; // Lấy byte từ memory, nếu không có thì là null
                let byte;
                try {
                    byte = simulator.tilelinkMem.readByte(byteAddr);
                } catch {
                    byte = null;
                }      
                bytes.push(byte);
                if (byte !== null) {
                    allBytesNull = false;
                    wordValue |= (byte << (k * 8)); // Ghép các byte thành word (little-endian)
                }
            }

            // Định dạng giá trị hiển thị tùy theo chế độ (hex hoặc ascii)
            if (dataSegmentDisplayMode === 'hex') {
                if (allBytesNull) {
                    displayValue = '........'; // Nếu word không có dữ liệu
                } else {
                    // Hiển thị dạng hex không dấu 32-bit
                    displayValue = `0x${(wordValue >>> 0).toString(16).padStart(8, '0')}`;
                }
            } else { // Chế độ 'ascii'
                displayValue = '';
                for (const byte of bytes) {
                    if (byte !== null && byte >= 32 && byte <= 126) { // Ký tự ASCII in được
                        displayValue += String.fromCharCode(byte);
                    } else {
                        displayValue += '.'; // Ký tự thay thế cho byte không in được hoặc null
                    }
                }
            }
            row.insertCell().textContent = displayValue; // Thêm ô giá trị vào hàng
        }
    }
}
// Cập nhật toàn bộ giao diện người dùng với trạng thái hiện tại của simulator
function updateUIGlobally() {
    const currentSimulator = simulator; // Tham chiếu đến đối tượng simulator

    // Cập nhật bảng thanh ghi số nguyên (x0-x31 và PC)
    if (registerTableBody) {
        for (let i = 0; i < 32; i++) { // Cập nhật x0-x31
            const row = document.getElementById(`reg-${i}`);
            if (row && row.cells.length >= 2) { // Đảm bảo hàng và ô tồn tại
                const value = currentSimulator.registers[i]; // Lấy giá trị từ simulator
                const cells = row.cells;
                const oldValueHex = cells[1].textContent; // Giá trị Hex cũ trong ô
                const newValueHex = `0x${(value >>> 0).toString(16).padStart(8, '0')}`; // Giá trị Hex mới

                // Highlight nếu giá trị thay đổi
                if (newValueHex !== oldValueHex && document.body.contains(row)) {
                    row.classList.add('highlight');
                } else if (document.body.contains(row)) {
                    row.classList.remove('highlight');
                }
                cells[1].textContent = newValueHex; // Cập nhật ô "Value" (Hex)
            }
        }
        const pcRowElement = document.getElementById('reg-pc'); // Cập nhật PC
        if (pcRowElement && pcRowElement.cells.length >= 2) {
            const pcValue = currentSimulator.pc;
            const cells = pcRowElement.cells;
            const oldPcHex = cells[1].textContent;
            const newPcHex = `0x${(pcValue >>> 0).toString(16).padStart(8, '0')}`;

            if (newPcHex !== oldPcHex && document.body.contains(pcRowElement)) {
                pcRowElement.classList.add('highlight');
            } else if (document.body.contains(pcRowElement)) {
                pcRowElement.classList.remove('highlight');
            }
            cells[1].textContent = newPcHex;
        }
    }

    // Cập nhật bảng thanh ghi điểm động (f0-f31)
    if (fpRegisterTableBody && currentSimulator.fregisters) {
        for (let i = 0; i < 32; i++) {
            const row = document.getElementById(`freg-${i}`);
            if (row && row.cells.length >= 3) { // Bảng FP có 3 cột
                const floatValue = currentSimulator.fregisters[i]; // Giá trị float từ simulator
                const cells = row.cells;

                // Chuyển đổi bit pattern của floatValue sang dạng hex
                const buffer = new ArrayBuffer(4);        // Tạo buffer 4 byte
                const view = new DataView(buffer);
                view.setFloat32(0, floatValue, true);     // Ghi giá trị float vào buffer (little-endian)
                const hexBits = `0x${(view.getInt32(0, true) >>> 0).toString(16).padStart(8, '0')}`; // Đọc lại bits dạng Int32, rồi chuyển sang hex không dấu

                const oldFloatDisplay = cells[1].textContent; // Giá trị float hiển thị cũ
                const newFloatDisplay = floatValue.toPrecision(7); // Định dạng giá trị float để hiển thị

                // Highlight nếu giá trị hiển thị thay đổi
                if (newFloatDisplay !== oldFloatDisplay && document.body.contains(row)) {
                    row.classList.add('highlight');
                } else if (document.body.contains(row)) {
                    row.classList.remove('highlight');
                }

                cells[1].textContent = newFloatDisplay;  // Cập nhật ô "Float Value"
                cells[2].textContent = hexBits;          // Cập nhật ô "Hex (Bits)"
            }
        }
    }

    // Cập nhật hiển thị Data Segment
    renderDataSegmentTable();

    // Xóa hiệu ứng highlight sau một khoảng thời gian ngắn
    setTimeout(() => {
        registerTableBody?.querySelectorAll('tr.highlight').forEach(r => r.classList.remove('highlight'));
        document.getElementById('reg-pc')?.classList.remove('highlight');
        fpRegisterTableBody?.querySelectorAll('tr.highlight').forEach(r => r.classList.remove('highlight'));
    }, 500);
}
// Đưa hàm updateUIGlobally ra phạm vi toàn cục để simulator có thể gọi khi cần (ví dụ sau khi chạy bất đồng bộ)
window.updateUIGlobally = updateUIGlobally;

// --- Xử lý sự kiện cho các nút điều khiển ---
// Xử lý sự kiện khi nhấn nút "Assemble"
function handleAssemble() {
    if (!assembler || !simulator || !binaryOutput || !instructionInput) return;
    binaryOutput.textContent = "Assembling..."; // Thông báo đang biên dịch
    if (dataSegmentBody) dataSegmentBody.innerHTML = '<tr><td colspan="9">Resetting simulator...</td></tr>';

    simulator.reset();      // Reset trạng thái simulator (bao gồm cả thanh ghi FP nếu có)
    updateUIGlobally();     // Cập nhật UI để hiển thị trạng thái đã reset (các thanh ghi về 0)

    // Dùng setTimeout để UI có thời gian cập nhật trước khi thực hiện tác vụ nặng (assemble)
    setTimeout(() => {
        try {
            const assemblyCode = instructionInput.value; // Lấy mã assembly từ ô nhập liệu
            const programData = assembler.assemble(assemblyCode); // Gọi hàm assemble từ assembler.js

            // Hiển thị mã nhị phân (và hex) đã biên dịch
            const binaryHexStrings = programData.instructions.map(instr => `${instr.hex}  (${instr.binary})`);
            binaryOutput.textContent = binaryHexStrings.join('\n');
            if (binaryHexStrings.length === 0 && !assemblyCode.trim().startsWith('.data')) {
                 if (Object.keys(programData.memory).length > 0 && assemblyCode.trim().startsWith('.data')){
                    binaryOutput.textContent = "(Data segment assembled, no executable instructions)";
                 } else {
                    binaryOutput.textContent = "(No instructions assembled)";
                 }
            }

            // Nạp chương trình đã biên dịch vào simulator
            simulator.loadProgram({
                memory: programData.memory,         // Bộ nhớ đã chứa cả data và instructions
                startAddress: programData.startAddress
            });

            // Cập nhật địa chỉ bắt đầu cho Data Segment View, ưu tiên vùng .data
            let dataStartAddrFound = false;
            if (programData.memory && Object.keys(programData.memory).length > 0) {
                const dataAddresses = [];
                const defaultDataBaseAddr = assembler.dataBaseAddress || 0x10010000;
                for (const addrStr in programData.memory) {
                    const addr = parseInt(addrStr);
                    if (addr >= defaultDataBaseAddr) { dataAddresses.push(addr); }
                }
                if (dataAddresses.length > 0) {
                     dataSegmentStartAddress = Math.min(...dataAddresses);
                     dataStartAddrFound = true;
                } else {
                    const allAddresses = Object.keys(programData.memory).map(Number).filter(addr => !isNaN(addr));
                    if(allAddresses.length > 0) {
                        dataSegmentStartAddress = Math.min(...allAddresses);
                        dataStartAddrFound = true;
                    }
                }
            }
            if (!dataStartAddrFound) {
                dataSegmentStartAddress = assembler.dataBaseAddress || 0x10010000;
            }
            dataSegmentStartAddress = Math.max(0, Math.floor(dataSegmentStartAddress / bytesPerRow) * bytesPerRow); // Căn chỉnh địa chỉ
            if (dataSegmentAddressInput) dataSegmentAddressInput.value = `0x${dataSegmentStartAddress.toString(16)}`; // Cập nhật ô input địa chỉ

            updateUIGlobally(); // Cập nhật lại toàn bộ UI sau khi nạp chương trình

            // Tùy chọn: Thực thi lệnh đầu tiên ngay sau khi assemble
            if (programData.instructions && programData.instructions.length > 0) {
                try {
                    simulator.step(); // simulator.step() sẽ tự gọi updateUIGlobally()
                } catch (stepError) {
                    console.error("Error during initial step execution:", stepError);
                    binaryOutput.textContent += `\n\nError during initial step: ${stepError.message}`;
                    updateUIGlobally(); // Cập nhật UI nếu có lỗi ở bước đầu
                }
            }

        } catch (error) { // Bắt lỗi từ quá trình assemble hoặc load
            console.error("Assembly or Loading Error:", error, error.stack);
            binaryOutput.textContent = `Error:\n${error.message}\n\n(Check console for details)`;
            if (dataSegmentBody) dataSegmentBody.innerHTML = '<tr><td colspan="9">Assembly/Loading failed.</td></tr>';
            
            // Reset lại cấu trúc và giá trị bảng thanh ghi khi có lỗi nghiêm trọng
            initializeRegisterTable();
            initializeFPRegisterTable(); 
            const pcRow = document.getElementById('reg-pc');
            if(pcRow && pcRow.cells.length > 1) pcRow.cells[1].textContent = '0x00000000'; // Đảm bảo ô giá trị PC tồn tại
        }
    }, 10); // Độ trễ nhỏ để UI kịp cập nhật
}

// Xử lý sự kiện khi nhấn nút "Run"
function handleRun() {
    if (!simulator) return;
    binaryOutput.textContent += "\n\n--- Running ---"; // Thêm thông báo vào output
    try {
        simulator.run(); // Bắt đầu chạy chương trình trong simulator
    } catch (e) {
        console.error("Error starting run:", e);
        alert(`Error starting run: ${e.message}`);
        updateUIGlobally(); // Cập nhật UI nếu có lỗi khi bắt đầu chạy
    }
}

// Xử lý sự kiện khi nhấn nút "Step"
function handleStep() {
    if (!simulator) return;
    try {
        simulator.step(); // Thực thi một lệnh trong simulator
    } catch (e) {
        console.error("Error during step:", e);
        const currentBinaryOutput = binaryOutput.textContent.split('\n\nStep Error:')[0]; // Tránh lặp lại thông báo lỗi cũ
        binaryOutput.textContent = currentBinaryOutput + `\n\nStep Error: ${e.message}`;
        updateUIGlobally(); // Cập nhật UI để phản ánh trạng thái sau lỗi
    }
}

// Xử lý sự kiện khi nhấn nút "Reset"
function handleReset() {
    if (!simulator || !instructionInput || !binaryOutput || !dataSegmentBody) return;

    simulator.stop();    // Dừng simulator nếu đang chạy
    simulator.reset();   // Reset trạng thái của simulator (thanh ghi, bộ nhớ, PC)

    // Xóa các ô input và output
    instructionInput.value = "";
    binaryOutput.textContent = "";
    // Đặt lại địa chỉ xem Data Segment
    dataSegmentStartAddress = assembler.dataBaseAddress || 0x10010000;
    if (dataSegmentAddressInput) dataSegmentAddressInput.value = `0x${dataSegmentStartAddress.toString(16)}`;

    updateUIGlobally(); // Cập nhật UI để hiển thị trạng thái đã reset

    // Đảm bảo bảng thanh ghi số nguyên được hiển thị mặc định sau khi reset
    if (registerTable && fpRegisterTable && toggleRegisterViewButton) {
        registerTable.classList.add('active-table');
        fpRegisterTable.classList.remove('active-table');
        toggleRegisterViewButton.textContent = "View Floating-Point Registers";
        currentRegisterView = 'integer';
    }
    console.log("System reset complete.");
}


// --- Gắn các trình xử lý sự kiện khi DOM đã sẵn sàng ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM loaded. Initializing UI components...");

    // Khởi tạo cấu trúc ban đầu cho cả hai bảng thanh ghi
    initializeRegisterTable();
    initializeFPRegisterTable();

    // Gắn sự kiện cho nút chuyển đổi chế độ xem thanh ghi
    if (toggleRegisterViewButton && registerTable && fpRegisterTable) {
        toggleRegisterViewButton.addEventListener('click', () => {
            if (currentRegisterView === 'integer') {
                registerTable.classList.remove('active-table'); // Ẩn bảng integer
                fpRegisterTable.classList.add('active-table');    // Hiện bảng FP
                toggleRegisterViewButton.textContent = "View Integer Registers";
                currentRegisterView = 'fp';
            } else {
                fpRegisterTable.classList.remove('active-table'); // Ẩn bảng FP
                registerTable.classList.add('active-table');    // Hiện bảng integer
                toggleRegisterViewButton.textContent = "View Floating-Point Registers";
                currentRegisterView = 'integer';
            }
        });
    } else {
        console.error("Toggle register view button or register tables not found in DOM.");
    }

    // Gắn sự kiện cho nút chuyển đổi chế độ xem Data Segment (Hex/ASCII)
    if (toggleDataSegmentModeButton) {
        toggleDataSegmentModeButton.addEventListener('click', () => {
            dataSegmentDisplayMode = (dataSegmentDisplayMode === 'hex') ? 'ascii' : 'hex';
            renderDataSegmentTable(); // Vẽ lại bảng Data Segment với chế độ mới
        });
    } else { console.error("Data segment toggle mode button not found."); }

    // Gắn sự kiện cho việc đi đến địa chỉ trong Data Segment
    if (goToDataSegmentAddressButton && dataSegmentAddressInput) {
        const goToAddress = () => {
            const addrStr = dataSegmentAddressInput.value.trim(); // Lấy địa chỉ từ input
            let newAddr;
            try {
                // Parse địa chỉ (hỗ trợ cả hex và decimal)
                if (addrStr.toLowerCase().startsWith('0x')) {
                    newAddr = parseInt(addrStr, 16);
                } else if (addrStr === '') { // Nếu rỗng, giữ nguyên địa chỉ hiện tại
                    newAddr = dataSegmentStartAddress;
                } else {
                    newAddr = parseInt(addrStr, 10);
                }

                if (!isNaN(newAddr) && newAddr >= 0) { // Nếu địa chỉ hợp lệ
                    // Căn chỉnh địa chỉ về đầu hàng và vẽ lại bảng
                    dataSegmentStartAddress = Math.max(0, Math.floor(newAddr / bytesPerRow) * bytesPerRow);
                    renderDataSegmentTable();
                    dataSegmentAddressInput.value = `0x${dataSegmentStartAddress.toString(16)}`; // Cập nhật lại ô input
                } else {
                    alert(`Invalid address format: "${addrStr}"`);
                    dataSegmentAddressInput.value = `0x${dataSegmentStartAddress.toString(16)}`; // Khôi phục giá trị cũ
                }
            } catch (e) {
                alert(`Error parsing address: "${addrStr}"`);
                dataSegmentAddressInput.value = `0x${dataSegmentStartAddress.toString(16)}`; // Khôi phục
            }
        };
        goToDataSegmentAddressButton.addEventListener('click', goToAddress);
        dataSegmentAddressInput.addEventListener('keypress', function (e) { // Cho phép nhấn Enter
            if (e.key === 'Enter') {
                goToAddress();
            }
        });
    } else { console.error("Data segment address search elements not found."); }

    // Khởi tạo simulator và cập nhật UI lần đầu
    if (typeof simulator !== 'undefined') {
        simulator.reset(); // Reset trạng thái simulator
        if (dataSegmentAddressInput) dataSegmentAddressInput.value = `0x${dataSegmentStartAddress.toString(16)}`;
        updateUIGlobally(); // Cập nhật toàn bộ UI (thanh ghi về 0, data segment trống)
    } else {
        console.error("Simulator module not loaded!");
        if (dataSegmentBody) dataSegmentBody.innerHTML = '<tr><td colspan="9">Error: Simulator not loaded.</td></tr>';
    }

    // Gắn sự kiện cho các nút điều khiển chính
    assembleButton?.addEventListener('click', handleAssemble);
    runButton?.addEventListener('click', handleRun);
    stepButton?.addEventListener('click', handleStep);
    resetButton?.addEventListener('click', handleReset);

    console.log("Event listeners attached. UI is ready.");
});
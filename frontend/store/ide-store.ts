import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import { Contract } from '@/lib/api';
import { storage, initStorage, StoredFile, ChatSession, ChatMessage } from '@/lib/storage';

export interface File {
  id: string;
  name: string;
  content: string;
  language: string;
  path: string;
  type?: 'contract' | 'test';
}

export interface ConsoleMessage {
  id: string;
  type: 'info' | 'error' | 'warning' | 'success';
  message: string;
  timestamp: Date;
}

export interface ContractInstance {
  blueprintId: string;
  contractId: string;
  contractName: string;
  timestamp: Date;
}

interface IDEState {
  // Files
  files: File[];
  openFileIds: string[];
  activeFileId: string | null;

  // Console
  consoleMessages: ConsoleMessage[];
  messageIdCounter: number;
  lastExecutionLogs: string | null;  // Store last execution logs from Pyodide

  // Contracts
  compiledContracts: Contract[];
  contractInstances: Record<string, ContractInstance>; // Track initialized contract instances by file ID

  // Chat Sessions
  chatSessions: ChatSession[];
  activeChatSessionId: string | null;

  // UI State
  isCompiling: boolean;
  isExecuting: boolean;
  isRunningTests: boolean;
  isStorageInitialized: boolean;

  // Actions
  addFile: (file: File) => void;
  updateFile: (id: string, content: string) => void;
  deleteFile: (id: string) => void;
  setActiveFile: (id: string) => void;
  openFile: (fileId: string) => void;
  closeFile: (fileId: string) => void;
  reorderFiles: (fromIndex: number, toIndex: number) => void;

  addConsoleMessage: (type: ConsoleMessage['type'], message: string) => void;
  clearConsole: () => void;
  setLastExecutionLogs: (logs: string | null) => void;

  addCompiledContract: (contract: Contract) => void;
  addContractInstance: (fileId: string, instance: ContractInstance) => void;
  getContractInstance: (fileId: string) => ContractInstance | null;
  clearContractInstances: () => void;

  setIsCompiling: (value: boolean) => void;
  setIsExecuting: (value: boolean) => void;
  setIsRunningTests: (value: boolean) => void;

  // Chat session actions
  createChatSession: () => string;
  addChatMessage: (sessionId: string, message: ChatMessage) => void;
  getChatSession: (id: string) => ChatSession | null;
  setActiveChatSession: (id: string) => void;
  deleteChatSession: (id: string) => void;

  // Storage operations
  initializeStore: () => Promise<void>;
  loadFilesFromStorage: () => Promise<void>;
  saveFileToStorage: (file: File) => Promise<void>;
  deleteFileFromStorage: (id: string) => Promise<void>;
  loadChatSessionsFromStorage: () => Promise<void>;
}

const createIDEStore: StateCreator<IDEState> = (set, get) => ({
  // Initial state
  files: [
    {
      id: '1',
      name: 'SimpleCounter.py',
      content: `from hathor import Blueprint, Context, NCFail, export, public, view

@export
class SimpleCounter(Blueprint):
    """A simple counter that can be incremented and read"""

    # Contract state
    count: int

    @public
    def initialize(self, ctx: Context) -> None:
        """Initialize the counter"""
        self.count = 0

    @public
    def increment(self, ctx: Context, amount: int) -> None:
        """Increment the counter by the specified amount"""
        if amount <= 0:
            raise NegativeIncrement("Amount must be positive")

        self.count += amount

    @view
    def get_count(self) -> int:
        """Get the current counter value"""
        return self.count

    @public
    def reset(self, ctx: Context) -> None:
        """Reset the counter to zero"""
        self.count = 0


class NegativeIncrement(NCFail):
    pass
`,
      language: 'python',
      path: '/contracts/SimpleCounter.py',
      type: 'contract',
    },
    {
      id: '2',
      name: 'test_simple_counter.py',
      content: `from hathor.nanocontracts.nc_types import make_nc_type_for_arg_type as make_nc_type


COUNTER_NC_TYPE = make_nc_type(int)


class CounterTestCase(BlueprintTestCase):
    def setUp(self):
        super().setUp()

        self.blueprint_id = self.gen_random_blueprint_id()
        self.contract_id = self.gen_random_contract_id()
        self.address = self.gen_random_address()

        self.nc_catalog.blueprints[self.blueprint_id] = SimpleCounter
        self.tx = self.get_genesis_tx()


    def test_lifecycle(self) -> None:
        context = self.create_context(
            vertex=self.tx,
            caller_id=self.address,
            timestamp=self.now
        )

        # Create a contract.
        self.runner.create_contract(
            self.contract_id,
            self.blueprint_id,
            context,
        )

        self.nc_storage = self.runner.get_storage(self.contract_id)

        self.assertEqual(0, self.nc_storage.get_obj(b'count', COUNTER_NC_TYPE))

        # increment
        AMOUNT = 3
        self.runner.call_public_method(self.contract_id, 'increment', context, AMOUNT)
        self.assertEqual(AMOUNT, self.nc_storage.get_obj(b'count', COUNTER_NC_TYPE))

        # call get_count
        ret = self.runner.call_view_method(self.contract_id, 'get_count')
        self.assertEqual(AMOUNT, ret)

        with self.assertRaises(NegativeIncrement):
            self.runner.call_public_method(self.contract_id, 'increment', context, -2)

        # reset
        self.runner.call_public_method(self.contract_id, 'reset', context)
        self.assertEqual(0, self.nc_storage.get_obj(b'count', COUNTER_NC_TYPE))`,
      language: 'python',
      path: '/tests/test_simple_counter.py',
      type: 'test',
    },
    {
      id: '3',
      name: 'SwapDemo.py',
      content: `from hathor import Blueprint, Context, NCDepositAction, NCFail, NCWithdrawalAction, TokenUid, export, public, view

@export
class SwapDemo(Blueprint):
    """Blueprint to execute swaps between tokens.
    This blueprint is here just as a reference for blueprint developers, not for real use.
    """

    # TokenA identifier and quantity multiplier.
    token_a: TokenUid
    multiplier_a: int

    # TokenB identifier and quantity multiplier.
    token_b: TokenUid
    multiplier_b: int

    # Count number of swaps executed.
    swaps_counter: int

    @public(allow_deposit=True)
    def initialize(
        self,
        ctx: Context,
        token_a: TokenUid,
        token_b: TokenUid,
        multiplier_a: int,
        multiplier_b: int
    ) -> None:
        """Initialize the contract."""

        if token_a == token_b:
            raise NCFail

        if set(ctx.actions.keys()) != {token_a, token_b}:
            raise InvalidTokens

        self.token_a = token_a
        self.token_b = token_b
        self.multiplier_a = multiplier_a
        self.multiplier_b = multiplier_b
        self.swaps_counter = 0

    @public(allow_deposit=True, allow_withdrawal=True)
    def swap(self, ctx: Context) -> None:
        """Execute a token swap."""

        if set(ctx.actions.keys()) != {self.token_a, self.token_b}:
            raise InvalidTokens

        action_a = ctx.get_single_action(self.token_a)
        action_b = ctx.get_single_action(self.token_b)

        if not (
            (isinstance(action_a, NCDepositAction) and isinstance(action_b, NCWithdrawalAction))
            or (isinstance(action_a, NCWithdrawalAction) and isinstance(action_b, NCDepositAction))
        ):
            raise InvalidActions

        if not self.is_ratio_valid(action_a.amount, action_b.amount):
            raise InvalidRatio

        # All good! Let's accept the transaction.
        self.swaps_counter += 1

    @view
    def is_ratio_valid(self, qty_a: int, qty_b: int) -> bool:
        """Check if the swap quantities are valid."""
        return (self.multiplier_a * qty_a == self.multiplier_b * qty_b)


class InvalidTokens(NCFail):
    pass


class InvalidActions(NCFail):
    pass


class InvalidRatio(NCFail):
    pass
      `,
      language: 'python',
      path: '/contracts/SwapDemo.py',
      type: 'contract',
    },
    {
      id: '4',
      name: 'test_swap_demo.py',
      content: `from hathor.nanocontracts.nc_types import make_nc_type_for_arg_type as make_nc_type
from hathor.nanocontracts.storage.contract_storage import Balance
from hathor.nanocontracts.types import NCDepositAction, NCWithdrawalAction, TokenUid


SWAP_NC_TYPE = make_nc_type(int)


class SwapDemoTestCase(BlueprintTestCase):
    def setUp(self):
        super().setUp()

        self.blueprint_id = self.gen_random_blueprint_id()
        self.contract_id = self.gen_random_contract_id()

        self.nc_catalog.blueprints[self.blueprint_id] = SwapDemo

        # Test doubles:
        self.token_a = self.gen_random_token_uid()
        self.token_b = self.gen_random_token_uid()
        self.token_c = self.gen_random_token_uid()
        self.address = self.gen_random_address()
        self.tx = self.get_genesis_tx()

    def _initialize(
        self,
        init_token_a: tuple[TokenUid, int, int],
        init_token_b: tuple[TokenUid, int, int]
    ) -> None:
        # Arrange:
        token_a, multiplier_a, amount_a = init_token_a
        token_b, multiplier_b, amount_b = init_token_b
        deposit_a = NCDepositAction(token_uid=token_a, amount=amount_a)
        deposit_b = NCDepositAction(token_uid=token_b, amount=amount_b)
        context = self.create_context(
            actions=[deposit_a, deposit_b],
            vertex=self.tx,
            caller_id=self.address,
            timestamp=self.now
        )

        # Act:
        self.runner.create_contract(
            self.contract_id,
            self.blueprint_id,
            context,
            token_a,
            token_b,
            multiplier_a,
            multiplier_b,
        )
        self.nc_storage = self.runner.get_storage(self.contract_id)

    def _swap(
        self,
        amount_a: tuple[int, TokenUid],
        amount_b: tuple[int, TokenUid]
    ) -> None:
        # Arrange:
        value_a, token_a = amount_a
        value_b, token_b = amount_b
        action_a_type = self.get_action_type(value_a)
        action_b_type = self.get_action_type(value_b)
        swap_a = action_a_type(token_uid=token_a, amount=abs(value_a))
        swap_b = action_b_type(token_uid=token_b, amount=abs(value_b))
        context = self.create_context(
            actions=[swap_a, swap_b],
            vertex=self.tx,
            caller_id=self.address,
            timestamp=self.now
        )

        # Act:
        self.runner.call_public_method(self.contract_id, 'swap', context)

    def test_lifecycle(self) -> None:
        # Create a contract.
        # Arrange and act within:
        self._initialize((self.token_a, 1, 100_00), (self.token_b, 1, 100_00))

        # Assert:
        self.assertEqual(
            Balance(value=100_00, can_mint=False, can_melt=False), self.nc_storage.get_balance(self.token_a)
        )
        self.assertEqual(
            Balance(value=100_00, can_mint=False, can_melt=False), self.nc_storage.get_balance(self.token_b)
        )
        self.assertEqual(0, self.nc_storage.get_obj(b'swaps_counter', SWAP_NC_TYPE))

        # Make a valid swap.
        # Arrange and act within:
        self._swap((20_00, self.token_a), (-20_00, self.token_b))
        # Assert:
        self.assertEqual(
            Balance(value=120_00, can_mint=False, can_melt=False), self.nc_storage.get_balance(self.token_a)
        )
        self.assertEqual(
            Balance(value=80_00, can_mint=False, can_melt=False), self.nc_storage.get_balance(self.token_b)
        )
        self.assertEqual(1, self.nc_storage.get_obj(b'swaps_counter', SWAP_NC_TYPE))

        # Make multiple invalid swaps raising all possible exceptions.
        with self.assertRaises(InvalidTokens):
            self._swap((-20_00, self.token_a), (20_00, self.token_c))
        with self.assertRaises(InvalidActions):
            self._swap((20_00, self.token_a), (40_00, self.token_b))
        with self.assertRaises(InvalidRatio):
            self._swap((20_00, self.token_a), (-40_00, self.token_b))

    def get_action_type(self, amount: int) -> type[NCDepositAction] | type[NCWithdrawalAction]:
        if amount >= 0:
            return NCDepositAction
        else:
            return NCWithdrawalAction
`,
      language: 'python',
      path: '/tests/test_swap_demo.py',
      type: 'test',
    },
  ],
  openFileIds: ['1'],
  activeFileId: '1',

  consoleMessages: [],
  messageIdCounter: 0,
  lastExecutionLogs: null,
  compiledContracts: [],
  contractInstances: {},

  chatSessions: [],
  activeChatSessionId: null,

  isCompiling: false,
  isExecuting: false,
  isRunningTests: false,
  isStorageInitialized: false,

  // Actions
  addFile: (file) => {
    set((state) => ({
      files: [...state.files, file],
      openFileIds: [...state.openFileIds, file.id],
      activeFileId: file.id,
    }));
    // Auto-persist to storage
    const state = get();
    if (state.isStorageInitialized) {
      state.saveFileToStorage(file).catch(console.error);
    }
  },

  updateFile: (id, content) => {
    set((state) => ({
      files: state.files.map((f) =>
        f.id === id ? { ...f, content } : f
      ),
    }));
    // Auto-persist to storage
    const state = get();
    if (state.isStorageInitialized) {
      const updatedFile = state.files.find(f => f.id === id);
      if (updatedFile) {
        state.saveFileToStorage(updatedFile).catch(console.error);
      }
    }
  },

  deleteFile: (id) => {
    set((state) => {
      const newOpenFileIds = state.openFileIds.filter((fileId) => fileId !== id);
      let newActiveFileId = state.activeFileId;
      if (state.activeFileId === id) {
        const closingTabIndex = state.openFileIds.indexOf(id);
        newActiveFileId = newOpenFileIds[closingTabIndex] || newOpenFileIds[newOpenFileIds.length - 1] || null;
      }
      return {
        files: state.files.filter((f) => f.id !== id),
        openFileIds: newOpenFileIds,
        activeFileId: newActiveFileId,
      };
    });
    // Delete from storage
    const state = get();
    if (state.isStorageInitialized) {
      state.deleteFileFromStorage(id).catch(console.error);
    }
  },

  setActiveFile: (id) => {
    set({ activeFileId: id });
    // Save active file preference
    const state = get();
    if (state.isStorageInitialized) {
      storage.setPreference('lastActiveFileId', id).catch(console.error);
    }
  },

  openFile: (fileId) => {
    set((state) => {
      if (!state.openFileIds.includes(fileId)) {
        return {
          openFileIds: [...state.openFileIds, fileId],
          activeFileId: fileId,
        };
      }
      return { activeFileId: fileId };
    });
  },

  closeFile: (fileId) => {
    set((state) => {
      const newOpenFileIds = state.openFileIds.filter((id) => id !== fileId);
      let newActiveFileId = state.activeFileId;
      if (state.activeFileId === fileId) {
        const closingTabIndex = state.openFileIds.indexOf(fileId);
        newActiveFileId = newOpenFileIds[closingTabIndex] || newOpenFileIds[newOpenFileIds.length - 1] || null;
      }
      return {
        openFileIds: newOpenFileIds,
        activeFileId: newActiveFileId,
      };
    });
  },

  reorderFiles: (fromIndex, toIndex) => {
    set((state) => {
      const newOpenFileIds = [...state.openFileIds];
      const [movedItem] = newOpenFileIds.splice(fromIndex, 1);
      newOpenFileIds.splice(toIndex, 0, movedItem);
      return { openFileIds: newOpenFileIds };
    });
  },

  addConsoleMessage: (type, message) =>
    set((state) => ({
      consoleMessages: [
        ...state.consoleMessages,
        {
          id: `console-${++state.messageIdCounter}-${Date.now()}`,
          type,
          message,
          timestamp: new Date(),
        },
      ],
      messageIdCounter: state.messageIdCounter + 1,
    })),

  clearConsole: () =>
    set(() => ({
      consoleMessages: [],
      messageIdCounter: 0,
      lastExecutionLogs: null,
    })),

  setLastExecutionLogs: (logs) => set(() => ({ lastExecutionLogs: logs })),

  addCompiledContract: (contract) =>
    set((state) => ({
      compiledContracts: [...state.compiledContracts, contract],
    })),

  addContractInstance: (fileId: string, instance: ContractInstance) =>
    set((state) => ({
      contractInstances: {
        ...state.contractInstances,
        [fileId]: instance,
      },
    })),

  getContractInstance: (fileId: string) => {
    const state = get();
    return state.contractInstances[fileId] || null;
  },

  clearContractInstances: () =>
    set(() => ({
      contractInstances: {},
    })),

  setIsCompiling: (value) =>
    set(() => ({
      isCompiling: value,
    })),

  setIsExecuting: (value) =>
    set(() => ({
      isExecuting: value,
    })),

  setIsRunningTests: (value) =>
    set(() => ({
      isRunningTests: value,
    })),

  // Chat session actions
  createChatSession: () => {
    const sessionId = Date.now().toString();
    const newSession: ChatSession = {
      id: sessionId,
      messages: [],
      created: Date.now(),
      lastModified: Date.now(),
      title: 'New Chat Session'
    };

    set((state) => ({
      chatSessions: [...state.chatSessions, newSession],
      activeChatSessionId: sessionId,
    }));

    // Save to storage
    const state = get();
    if (state.isStorageInitialized) {
      storage.saveChatSession(newSession).catch(console.error);
    }

    return sessionId;
  },

  addChatMessage: (sessionId, message) => {
    set((state) => ({
      chatSessions: state.chatSessions.map(session =>
        session.id === sessionId
          ? {
            ...session,
            messages: [...session.messages, message],
            lastModified: Date.now(),
          }
          : session
      ),
    }));

    // Save to storage
    const state = get();
    if (state.isStorageInitialized) {
      const updatedSession = state.chatSessions.find(s => s.id === sessionId);
      if (updatedSession) {
        storage.saveChatSession(updatedSession).catch(console.error);
      }
    }
  },

  getChatSession: (id) => {
    const state = get();
    return state.chatSessions.find(session => session.id === id) || null;
  },

  setActiveChatSession: (id) => {
    set(() => ({
      activeChatSessionId: id,
    }));

    // Save active session preference
    const state = get();
    if (state.isStorageInitialized) {
      storage.setPreference('activeChatSessionId', id).catch(console.error);
    }
  },

  deleteChatSession: (id) => {
    set((state) => ({
      chatSessions: state.chatSessions.filter(session => session.id !== id),
      activeChatSessionId: state.activeChatSessionId === id ? null : state.activeChatSessionId,
    }));

    // Delete from storage
    const state = get();
    if (state.isStorageInitialized) {
      storage.deleteChatSession(id).catch(console.error);
    }
  },

  // Storage operations
  initializeStore: async () => {
    try {
      await initStorage();
      set({ isStorageInitialized: true });

      // Load files from storage
      const state = get();
      await state.loadFilesFromStorage();
      await state.loadChatSessionsFromStorage();

      console.log('IDE store initialized with persistent storage');
    } catch (error) {
      console.error('Failed to initialize storage:', error);
      // Continue with default files if storage fails
      set({ isStorageInitialized: false });
    }
  },

  loadFilesFromStorage: async () => {
    try {
      const storedFiles = await storage.getAllFiles();

      if (storedFiles.length > 0) {
        // Convert StoredFile to File format
        const files: File[] = storedFiles.map(stored => ({
          id: stored.id,
          name: stored.name,
          content: stored.content,
          language: stored.name.endsWith('.py') ? 'python' : 'text',
          path: `/contracts/${stored.name}`,
          type: (stored.type as 'contract' | 'test') || 'contract',
        }));

        // Get last active file ID from preferences
        const lastActiveFileId = await storage.getPreference('lastActiveFileId', files[0]?.id || null);
        const validActiveFileId = files.find(f => f.id === lastActiveFileId)?.id || files[0]?.id || null;

        set({
          files,
          activeFileId: validActiveFileId,
          openFileIds: validActiveFileId ? [validActiveFileId] : []
        });

        console.log(`Loaded ${files.length} files from storage`);
      } else {
        // First time - save default files to storage
        const state = get();
        for (const file of state.files) {
          await state.saveFileToStorage(file);
        }
        console.log('Saved default files to storage');
      }
    } catch (error) {
      console.error('Failed to load files from storage:', error);
    }
  },

  saveFileToStorage: async (file: File) => {
    try {
      const storedFile: StoredFile = {
        id: file.id,
        name: file.name,
        content: file.content,
        lastModified: Date.now(),
        created: Date.now(), // This should ideally come from existing stored file
        type: file.type || 'contract',
      };

      // Check if file exists to preserve created date
      const existingFile = await storage.getFile(file.id);
      if (existingFile) {
        storedFile.created = existingFile.created;
      }

      await storage.saveFile(storedFile);
    } catch (error) {
      console.error('Failed to save file to storage:', error);
    }
  },

  deleteFileFromStorage: async (id: string) => {
    try {
      await storage.deleteFile(id);
    } catch (error) {
      console.error('Failed to delete file from storage:', error);
    }
  },

  loadChatSessionsFromStorage: async () => {
    try {
      const storedSessions = await storage.getAllChatSessions();

      if (storedSessions.length > 0) {
        // Get active session ID from preferences
        const activeSessionId = await storage.getPreference('activeChatSessionId', null);
        const validActiveSessionId = storedSessions.find(s => s.id === activeSessionId)?.id || null;

        set({
          chatSessions: storedSessions,
          activeChatSessionId: validActiveSessionId,
        });

        console.log(`Loaded ${storedSessions.length} chat sessions from storage`);
      } else {
        console.log('No chat sessions found in storage');
      }
    } catch (error) {
      console.error('Failed to load chat sessions from storage:', error);
    }
  },
});

export const useIDEStore = create<IDEState>(createIDEStore);
